import { useState } from 'react'
import { Banner, Button, Dialog } from '@cloudflare/kumo'
import type { ConnectFlowStart } from '@gadgets/workshop-shared/api'
import { continueConnectInTab } from './sameTabConnect'

export const ContinueConnectDialog = ({ flow, onClose }: {
  flow: ConnectFlowStart
  onClose: () => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const continueHere = () => {
    try { continueConnectInTab(flow) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not start the connection.') }
  }
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog className="responsive-dialog space-y-4 p-6" size="sm">
        <Dialog.Title>Continue connection in this tab?</Dialog.Title>
        <Dialog.Description>
          Your browser blocked the connection window. Continue here to choose the account or server
          to connect. You will return to Gatekeepers when the connection finishes.
        </Dialog.Description>
        {error && <Banner variant="error" title={error} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={continueHere}>Continue in this tab</Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
