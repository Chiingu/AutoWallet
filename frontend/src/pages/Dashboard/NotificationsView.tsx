import { ArrowDownLeft, ArrowLeft, ChevronRight, Mail } from 'lucide-react'
import { useState } from 'react'
import type { DashboardTransaction } from './dashboardApi'
import { envelopeMeta, money, walletOrder } from './envelopeDisplay'
import { formatDate } from '../../utils/format'
import { hasCompleteSplit } from './paymentUtils'

export function NotificationsView({ payments, readIds, unread, onRead, onSelect, onBack, onSettings, enabled = true, compact = false }: {
  payments: DashboardTransaction[]; readIds: string[]; unread: number
  onRead: (ids: string[]) => void; onSelect: (payment: DashboardTransaction) => void
  onBack?: () => void; onSettings?: () => void; enabled?: boolean; compact?: boolean
}) {
  const [limit, setLimit] = useState(30)
  const visible = compact ? payments.filter(payment => !readIds.includes(payment.id)).slice(0, 5) : payments.slice(0, limit)
  return <section className={`notifications-view ${compact ? 'notifications-view--compact' : 'workspace-page'}`} aria-label="Notifications">
    <header><div className="workspace-title-row">{onBack && !compact && <button className="notifications-back" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button>}<h1>Notifications</h1></div><button disabled={!unread} onClick={() => onRead(payments.map(item => item.id))}>Mark all as read</button></header>
    {unread > 0 ? <><div className="notifications-list" aria-label="Payment updates">{visible.map(payment => {
      const isUnread = !readIds.includes(payment.id)
      const split = hasCompleteSplit(payment) ? walletOrder.filter(type => (payment.allocations?.[type] ?? 0) > 0).map(type => envelopeMeta[type].name) : []
      return <button key={payment.id} className={`notification-item ${isUnread ? 'notification-item--unread' : ''}`} onClick={() => { onRead([payment.id]); onSelect(payment) }}>
        <span className="notification-icon"><ArrowDownLeft size={18} /></span><span className="notification-content"><strong>+{money.format(payment.amount)} MAD from {payment.reference}</strong><span>{payment.status === 'failed' ? 'Payment processing failed.' : payment.status === 'pending' ? 'Waiting for the payment to finish processing.' : split.length ? `Split into ${split.join(', ')}.` : 'Payment processed. Open to view its status.'}</span><small>{formatDate(payment.created_at, true) || 'Time not provided'}</small></span>{isUnread && <span className="notification-dot" aria-label="Unread" />}
      </button>
    })}</div>{!compact && <div className="notifications-pagination"><p role="status">Showing {visible.length} of {payments.length} payment updates</p>{visible.length < payments.length && <button type="button" className="dashboard-secondary-button" onClick={() => setLimit(value => value + 30)}>Load more notifications</button>}</div>}</> : <div className="notifications-empty"><div className="notifications-art" aria-hidden="true"><Mail /><Mail /><Mail /></div><h2>{enabled ? 'You’re all caught up.' : 'Payment alerts are off.'}</h2><p>{enabled ? 'New payment updates show up here.' : 'Turn them on in Notification settings to see payment updates here.'}</p></div>}
    <footer>{onSettings && <button onClick={onSettings}>Notification settings <ChevronRight size={13} /></button>}<span>Payment updates · Read status saved in this browser</span>{compact && <button onClick={onBack}>View notifications <ChevronRight size={13} /></button>}</footer>
  </section>
}
