import { clipboard } from 'electron'
import { TAG_RARITY } from '../components/parser/constants'
import { logger } from './logger'

export async function pollClipboard (delay: number, limit: number): Promise<string> {
  let textBefore = clipboard.readText()
  let elapsed = 0

  if (textBefore.startsWith(TAG_RARITY)) {
    textBefore = ''
    clipboard.writeText('')
  }

  return new Promise((resolve, reject) => {
    function poll () {
      const textAfter = clipboard.readText()

      if (textAfter.startsWith(TAG_RARITY)) {
        clipboard.writeText(textBefore)
        resolve(textAfter)
      } else {
        elapsed += delay
        if (elapsed < limit) {
          setTimeout(poll, delay)
        } else {
          logger.warn('No changes found', { source: 'clipboard', timeout: limit })
          reject(new Error('Clipboard was not changed'))
        }
      }
    }

    poll()
  })
}
