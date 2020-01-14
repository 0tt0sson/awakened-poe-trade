import { BrowserWindow, ipcMain, screen, Rectangle } from 'electron'
import ioHook from 'iohook'
import { win } from './window'
import { checkPressPosition, isPollingClipboard } from './shortcuts'
import { windowManager } from './window-manager'

const CLOSE_THRESHOLD_PX = 40

let isCtrlDown = false
let isWindowShown = true

export function setupShowHide () {
  ipcMain.on('price-check-visible', async (e, isVisible) => {
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
    }
  })

  ioHook.on('mousemove', (e: { x: number, y: number }) => {
    if (!isPollingClipboard && checkPressPosition && isWindowShown && !isCtrlDown) {
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
  const poePos = (await windowManager.getActiveWindowBounds())!

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
