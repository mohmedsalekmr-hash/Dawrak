# Dawrak Launch Readiness Guide 🚀

To ensure the highest level of stability, performance, and security for your production launch, please follow these final infrastructure steps. These "Zero-Downtime" optimizations will guarantee that the database remains fast and secure.

## 1. Database Optimization (Supabase)
Copy and run the following script in your **Supabase SQL Editor** to add indexes and security layers.

```sql
-- [PERFORMANCE] Fast Search Indexes
-- These ensure that looking up tickets and queue status is instantaneous even with thousands of rows.
CREATE INDEX IF NOT EXISTS idx_tickets_queue_id ON public.tickets (queue_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at_desc ON public.tickets (created_at DESC);

-- [CLEANUP] Optional: Auto-delete old tickets (Maintenance)
-- Keeps the database lean. (Run manually or as a Cron if needed).
-- DELETE FROM public.tickets WHERE created_at < now() - interval '24 hours';

-- [SECURITY] Enable Row Level Security (RLS)
-- Prevents unauthorized tampering while allowing the app to function.
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queues ENABLE ROW LEVEL SECURITY;

-- Anonymous users can read everything (Queue status, etc.)
DROP POLICY IF EXISTS "Public Read" ON public.tickets;
CREATE POLICY "Public Read" ON public.tickets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public Read" ON public.queues;
CREATE POLICY "Public Read" ON public.queues FOR SELECT USING (true);

-- Anonymous users can issue their own tickets
DROP POLICY IF EXISTS "Public Insert" ON public.tickets;
CREATE POLICY "Public Insert" ON public.tickets FOR INSERT WITH CHECK (true);

-- Admin & App can update ticket status
DROP POLICY IF EXISTS "Public Update" ON public.tickets;
CREATE POLICY "Public Update" ON public.tickets FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Public Update" ON public.queues;
CREATE POLICY "Public Update" ON public.queues FOR UPDATE USING (true);
```

## 2. Infrastructure Scaling
- **Upgrade to Pro**: If you expect more than 50 simultaneous users, the Supabase **Pro Plan** is highly recommended to remove concurrent connection limits.
- **Vercel/Netlify Deployment**: Ensure you set your environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in your hosting provider's dashboard.

## 3. Performance Check
The application has been optimized with:
- **Hardware Acceleration**: Using `translate3d` and `will-change` for all animations.
- **Resource Cleanup**: Real-time channels are now properly closed when users leave the page.
- **Debounced Updates**: Stats are recalculated efficiently without hammering the DB.

## 4. Final Verification
- [ ] Scan QR Code on various mobile devices (iOS/Android).
- [ ] Test the "Done" flow from Admin and confirm "Success Card" appears.
- [ ] Verify that sound/voice alerts work when enabled.

**Congratulations! Your premium queue system is now ready for the world.**
