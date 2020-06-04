import { screen, Point, clipboard, globalShortcut, Notification } from 'electron'
import robotjs from 'robotjs'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { pollClipboard } from './PollClipboard'
import { showWindow, lockWindow, mousePosFromEvent } from './positioning'
import { KeyToElectron } from '@/ipc/KeyToCode'
import { PRICE_CHECK } from '@/ipc/ipc-event'
import { config } from './config'
import { PoeWindow } from './PoeWindow'
import { openWiki } from './wiki'
import { logger } from './logger'
import { toggleOverlayState, overlayWindow } from './overlay-window'

export let isPollingClipboard = false
export let checkPressPosition: Point | undefined

export const UiohookToName = Object.fromEntries(Object.entries(UiohookKey).map(([k, v]) => ([v, k])))

function priceCheck (lockedMode: boolean) {
  logger.info('Price check', { source: 'price-check', lockedMode })

  if (!isPollingClipboard) {
    isPollingClipboard = true
    pollClipboard(32, 500)
      .then(async (clipboard) => {
        overlayWindow!.webContents.send(PRICE_CHECK, { clipboard, position: PoeWindow.getPoeUiPosition(checkPressPosition!) })
        showWindow()
        if (lockedMode) {
          lockWindow(true)
        }
      })
      .catch(() => { /* nothing bad */ })
      .finally(() => { isPollingClipboard = false })
  }
  checkPressPosition = screen.getCursorScreenPoint()

  if (!lockedMode) {
    if (config.get('priceCheckKeyHold') === 'Ctrl') {
      robotjs.keyTap('C')
    } else {
      robotjs.keyTap('C', ['Ctrl'])
    }
  } else {
    robotjs.keyTap('C', ['Ctrl'])
  }
}

function registerGlobal () {
  const register = [
    shortcutCallback(
      config.get('priceCheckKey') && `${config.get('priceCheckKeyHold')} + ${config.get('priceCheckKey')}`,
      () => priceCheck(false),
      { doNotResetModKey: true }
    ),
    shortcutCallback(
      config.get('priceCheckLocked'),
      () => priceCheck(true)
    ),
    shortcutCallback(
      config.get('overlayKey'),
      toggleOverlayState
    ),
    shortcutCallback(
      config.get('wikiKey'),
      () => {
        pollClipboard(32, 500).then(openWiki).catch(() => {})
        robotjs.keyTap('C', ['Ctrl'])
      }
    ),
    ...config.get('commands')
      .map(command =>
        shortcutCallback(command.hotkey, () => typeChatCommand(command.text))
      )
  ].filter(a => Boolean(a.shortcut))

  register.forEach(a => {
    const success = globalShortcut.register(shortcutToElectron(a.shortcut!), a.cb)
    if (!success) {
      new Notification({
        title: 'Awakened PoE Trade',
        body: `Cannot register shortcut ${a.shortcut}, because it is already registered by another application.`
      }).show()
    }
  })

  logger.verbose('Registered Global', { source: 'shortcuts', total: register.length })
}

function unregisterGlobal () {
  globalShortcut.unregisterAll()
  logger.verbose('Unregistered Global', { source: 'shortcuts' })
}

export function setupShortcuts () {
  // A value of zero causes the thread to relinquish the remainder of its
  // time slice to any other thread that is ready to run. If there are no other
  // threads ready to run, the function returns immediately
  robotjs.setKeyboardDelay(0)

  if (PoeWindow.isActive && config.get('useOsGlobalShortcut')) {
    registerGlobal()
  }
  PoeWindow.on('active-change', (isActive) => {
    if (config.get('useOsGlobalShortcut')) {
      process.nextTick(() => {
        if (isActive === PoeWindow.isActive) {
      if (isActive) {
        registerGlobal()
      } else {
        unregisterGlobal()
      }
    }
  })
    }
  })

  uIOhook.on('keydown', (e) => {
    const pressed = eventToString(e)
    logger.debug('Keydown', { source: 'shortcuts', keys: pressed })

    if (!PoeWindow.isActive || config.get('useOsGlobalShortcut')) return

    if (pressed === `${config.get('priceCheckKeyHold')} + ${config.get('priceCheckKey')}`) {
      shortcutCallback(pressed, () => {
        priceCheck(false)
      }, { doNotResetModKey: true }).cb()
    } else if (pressed === config.get('priceCheckLocked')) {
      shortcutCallback(pressed, () => {
        priceCheck(true)
      }).cb()
    } else if (pressed === config.get('overlayKey')) {
      shortcutCallback(pressed, toggleOverlayState).cb()
    } else if (pressed === config.get('wikiKey')) {
      shortcutCallback(pressed, () => {
        pollClipboard(32, 500).then(openWiki).catch(() => {})
        robotjs.keyTap('C', ['Ctrl'])
      }).cb()
    } else {
      const command = config.get('commands').find(c => c.hotkey === pressed)
      if (command) {
        shortcutCallback(pressed, () => {
          typeChatCommand(command.text)
        }).cb()
      }
    }
  })

  uIOhook.on('keyup', (e) => {
    logger.debug('Keyup', { source: 'shortcuts', key: UiohookToName[e.keycode] || 'unknown' })
  })

  uIOhook.on('wheel', async (e) => {
    if (!e.ctrlKey || !PoeWindow.bounds || !PoeWindow.isActive || !config.get('stashScroll')) return

    const stashCheckX = PoeWindow.bounds.x + PoeWindow.uiSidebarWidth
    const mouseX = mousePosFromEvent(e).x
    if (mouseX > stashCheckX) {
      if (e.rotation > 0) {
        robotjs.keyTap('ArrowRight')
      } else if (e.rotation < 0) {
        robotjs.keyTap('ArrowLeft')
      }
    }
  })

  uIOhook.start()
}

function typeChatCommand (command: string) {
  const saved = clipboard.readText()

  const whisperLast = command.startsWith('@last ')
  const commandLast = command.endsWith(' @last')
  if (whisperLast) {
    command = command.substr('@last '.length)
    clipboard.writeText(command)
    robotjs.keyTap('Enter', ['Ctrl'])
  } else if (commandLast) {
    command = command.slice(0, -'@last'.length)
    clipboard.writeText(command)
    robotjs.keyTap('Enter', ['Ctrl'])
    robotjs.keyTap('Home')
    robotjs.keyTap('Delete')
  } else {
    clipboard.writeText(command)
    robotjs.keyTap('Enter')
  }

  robotjs.keyTap('V', ['Ctrl'])
  robotjs.keyTap('Enter')
  // restore the last chat
  robotjs.keyTap('Enter')
  robotjs.keyTap('ArrowUp')
  robotjs.keyTap('ArrowUp')
  robotjs.keyTap('Escape')

  setTimeout(() => {
    clipboard.writeText(saved)
  }, 100)
}

function eventToString (e: { keycode: number, ctrlKey: boolean, altKey: boolean, shiftKey: boolean }) {
  const { ctrlKey, shiftKey, altKey } = e

  let code = UiohookToName[e.keycode]
  if (!code) return 'unknown'

  if (code === 'Shift' || code === 'Alt' || code === 'Ctrl') return code

  if (shiftKey && altKey) code = `Shift + Alt + ${code}`
  else if (ctrlKey && shiftKey) code = `Ctrl + Shift + ${code}`
  else if (ctrlKey && altKey) code = `Ctrl + Alt + ${code}`
  else if (altKey) code = `Alt + ${code}`
  else if (ctrlKey) code = `Ctrl + ${code}`
  else if (shiftKey) code = `Shift + ${code}`

  return code
}

function shortcutCallback<T extends Function> (shortcut: string | null, cb: T, opts?: { doNotResetModKey?: boolean }) {
  return {
    shortcut,
    cb: function () {
      if (!shortcut) throw new Error('Never: callback called on null shortcut')

      if (opts?.doNotResetModKey) {
        const nonModKey = shortcut.split(' + ').reverse()[0]
        robotjs.keyToggle(nonModKey, 'up')
      } else {
        shortcut.split(' + ').reverse().forEach(key => { robotjs.keyToggle(key, 'up') })
      }
      cb()
    }
  }
}

function shortcutToElectron (shortcut: string) {
  return shortcut
    .split(' + ')
    .map(k => KeyToElectron[k as keyof typeof KeyToElectron])
    .join('+')
}
