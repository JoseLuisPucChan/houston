/**
 * lib/database.js
 * Sets up database connection
 *
 * @exports {Object} - initialized mongoose object
 */

import mongoose from 'mongoose'

import Log from 'lib/log'

const log = new Log('lib:database')

mongoose.Promise = global.Promise

mongoose.connection.on('error', (msg) => {
  log.error('Database error')
  log.error(msg)

  log.report(msg)
})

mongoose.connection.once('open', () => log.info('Connected to database'))

mongoose.connection.once('close', () => log.warn('Disconnected to database'))

export default mongoose