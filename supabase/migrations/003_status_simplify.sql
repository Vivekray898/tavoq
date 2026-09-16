-- ============================================================
-- Taskora — Migration 003
-- Simplify the task status model (§27): five statuses.
-- APPROVED is folded into COMPLETED; payout>0 tasks become
-- payable (PENDING) so they surface in Payments.
-- ============================================================

UPDATE tasks
SET status = 'COMPLETED',
    payment_status = CASE
      WHEN payout_amount > 0 AND payment_status = 'NOT_APPLICABLE' THEN 'PENDING'
      ELSE payment_status
    END,
    completed_at = COALESCE(completed_at, now())
WHERE status = 'APPROVED';
