/**
 * service/stripe.js
 * Handles all communications to Stripe API
 * @flow
 *
 * @exports {Object} default - superagent for communicating with Stripe
 * @exports {Class} StripeError - error related to communication with Stripe
 * @exports {Function} postCharge - Creates a charge for Stripe connected account
 */

import { domain } from 'lib/request'
import * as error from 'lib/error/service'
import config from 'lib/config'
import Log from 'lib/log'

const log = new Log('service:stripe')

const auth = new Buffer(`${config.stripe.secret}:`).toString('base64')
const api = domain('https://api.stripe.com/v1')
.use((req) => {
  req.set('Authorization', `Basic ${auth}`)
  req.set('User-Agent', 'elementary-houston')
})

export default api

/**
 * errorCheck
 * Checks generatic Stripe status codes for a more descriptive error
 *
 * @param {Error} err - superagent error to check
 * @param {Object} [res] - Stripe response object
 * @returns {ServiceError} - a parsed error from Stripe
 */
const errorCheck = (err: Object, res: ?Object): error.ServiceError => {
  if (err.status === 401) {
    log.info(`Bad credentials`)
    return new error.ServiceError('Stripe', 'Bad Credentials')
  }

  if (err.status === 429) {
    log.warn('Exceeding maximum number of authentication calls to Stripe')
    return new error.ServiceLimitError('GitHub')
  }

  if (res != null) {
    if (res.body != null && res.body.error != null) {
      log.error(res.body.error)

      return new error.ServiceRequestError('Stripe', res.status, res.body.error)
    }

    log.error(err.toString())
    return new error.ServiceRequestError('Stripe', res.status, err.toString())
  }

  log.error(err)
  return new error.ServiceError('Stripe', err.toString())
}

/**
 * getCut
 * Does math things to find what amount to take as fee
 * NOTE: this expects the amount to be given in USD cents integer
 * NOTE: for use with Stripe API, use elementary as them application_fee, and
 * total amount as amount.
 *
 * @param {Number} amount - total amount of the payment
 *
 * @throws {StripeError} - when unable to cut the payment amount
 * @returns {Object} - processing fees
 * @returns {Number} stripe - the amount of money stripe takes for processing
 * @returns {Number} elementary - the amount of money elementary takes
 * @returns {Number} developer - the amount of money remaining for the developer
 * @returns {Number} total - the total amount of money
 */
export function getCut (amount: number): Object {
  const out = {}

  out['stripe'] = Math.ceil((amount * 0.029) + 30)

  out['elementary'] = Math.ceil(amount * 0.3)
  if (out['elementary'] < 50) out['elementary'] = 50
  out['elementary'] = Math.ceil(out['elementary'] - out['stripe'])

  out['developer'] = amount - out['elementary'] - out['stripe']

  out['total'] = amount

  return out
}

/**
 * postCharge
 * Creates a charge for Stripe connected account
 * NOTE: this will use getCut for calculating fee
 *
 * @param {String} account - a Stripe account ID that will receive the payment
 * @param {String} token - a Stripe charge token
 * @param {Number} amount - an amount to charge to the account
 * @param {String} currency - the 3-letter ISO code for currency
 * @param {String} [description] - an optional description to attach to the charge
 *
 * @throws {StripeError} - when unable to create charge
 * @returns {String} - Stripe charge ID
 */
export function postCharge (account: string, token: string, amount: number, currency: string, description: ?string): Promise<string> {
  if (!config.stripe || !config.stripe.client || !config.stripe.secret || !config.stripe.public) {
    log.debug('Config prohibits posting to Stripe. Not posting charge')
    return Promise.resolve('')
  }

  if (account.startsWith('acct_') === false) {
    throw new error.ServiceError('Stripe', 'Invalid destination for postCharge')
  }

  if (token.startsWith('tok_') === false) {
    throw new error.ServiceError('Stripe', 'Invalid token for postCharge')
  }

  if (currency !== 'USD') {
    throw new error.ServiceError('Stripe', 'Only USD currency is allowed')
  }

  const cut = getCut(amount)

  log.debug(`Creating a new charge for the amount of ${cut['total']} with developer getting ${cut['developer']}`)

  return api
  .post('/charges')
  .set('Stripe-Account', account)
  .type('form')
  .send({
    amount: cut['total'],
    application_fee: cut['elementary'],
    currency,
    description,
    source: token
  })
  .then((res) => res.body.id)
  .catch((err, res) => {
    throw errorCheck(err, res)
  })
}
