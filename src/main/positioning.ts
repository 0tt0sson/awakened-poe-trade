import { BrowserWindow, ipcMain, screen, Rectangle, BrowserView } from 'electron'
import ioHook from 'iohook'
import { win } from './window'
import { checkPressPosition, isPollingClipboard, poeWindowId } from './shortcuts'
import { windowManager } from './window-manager'
import { PRICE_CHECK_VISIBLE, LOCK_WINDOW, OPEN_LINK } from '../shared/ipc-event'

const CLOSE_THRESHOLD_PX = 40

let isWindowShown = true
let isWindowLocked = false

let lastPoePos: Rectangle
let browserViewExternal: BrowserView | undefined

export function setupShowHide () {
  ipcMain.on(PRICE_CHECK_VISIBLE, async (e, isVisible) => {
    if (isVisible) {
      await positionWindow(win)
      isWindowShown = true
      win.showInactive()
      if (process.platform === 'linux') {
        win.setAlwaysOnTop(true)
      }
    } else {
      isWindowShown = false
      win.hide()

      if (poeWindowId && isWindowLocked) {
        isWindowLocked = false
        if (process.platform === 'win32') {
          windowManager.focusWindowById(poeWindowId)
        }
        if (browserViewExternal) {
          win.removeBrowserView(browserViewExternal)
          // uncomment to trade performance for less memory usage (1 process & 13 MB)
          // browserViewExternal.destroy()
          // browserViewExternal = undefined
          browserViewExternal.webContents.loadURL('about:blank')
        }
      }
    }
  })

  ipcMain.on(LOCK_WINDOW, () => {
    isWindowLocked = true
    win.focus()
  })

  ipcMain.on(OPEN_LINK, (e, link) => {
    if (!browserViewExternal) {
      browserViewExternal = new BrowserView()
    }

    win.setBrowserView(browserViewExternal)
    win.setBounds(lastPoePos)
    browserViewExternal.setBounds({
      x: 0,
      y: 24,
      width: lastPoePos.width - 460,
      height: lastPoePos.height - 24
    })
    browserViewExternal.webContents.loadURL(link)
  })

  ioHook.on('mousemove', (e: { x: number, y: number, ctrlKey?: true }) => {
    if (!isPollingClipboard && checkPressPosition && isWindowShown && !e.ctrlKey && !isWindowLocked) {
      let distance: number
      if (process.platform === 'linux' /* @TODO: && displays.length > 1 */) {
        // ioHook returns mouse position that is not compatible with electron's position
        // when user has more than one monitor
        const cursorNow = screen.getCursorScreenPoint()
        distance = Math.hypot(cursorNow.x - checkPressPosition.x, cursorNow.y - checkPressPosition.y)
      } else {
        distance = Math.hypot(e.x - checkPressPosition.x, e.y - checkPressPosition.y)
      }

      if (distance > CLOSE_THRESHOLD_PX) {
        isWindowShown = false
        win.hide()
      }
    }
  })
}

async function positionWindow (tradeWindow: BrowserWindow) {
  const poePos = (await windowManager.getActiveWindowContentBounds())!
  lastPoePos = poePos

  tradeWindow.setBounds({
    x: getOffsetX(poePos),
    y: poePos.y,
    width: 460,
    height: poePos.height
  }, false)
}

function getOffsetX (poePos: Rectangle): number {
  const mousePos = screen.getCursorScreenPoint()

  if (mousePos.x > (poePos.x + poePos.width / 2)) {
    // inventory
    return (poePos.x + poePos.width) - poeUserInterfaceWidth(poePos.height) - 460
  } else {
    // stash or chat
    return poePos.x + poeUserInterfaceWidth(poePos.height)
  }
}

function poeUserInterfaceWidth (windowHeight: number) {
  // sidebar is 370px at 800x600
  const ratio = 370 / 600
  return Math.round(windowHeight * ratio)
}
