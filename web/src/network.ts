type ConnectionInfo = {
  saveData?: boolean
  type?: string
  effectiveType?: string
}

/** Browser support is optional; an unknown connection does not imply cellular. */
export function shouldConfirmCadDownload(connection?: ConnectionInfo) {
  return connection?.saveData === true || connection?.type === 'cellular' || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g'
}

export function currentConnectionNeedsConfirmation() {
  return shouldConfirmCadDownload((navigator as Navigator & { connection?: ConnectionInfo }).connection)
}
