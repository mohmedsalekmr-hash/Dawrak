# Dawrak - Smart Queue System

A premium queue management system built with Vue 3, Tailwind CSS, and Supabase.

## Features

- **Real-time Updates**: Live queue status using Supabase Realtime.
- **Smart Queueing**: Users can get a ticket and see their position.
- **Premium UI**: Dignified Green theme, Glassmorphism, and smooth animations.
- **Mobile First**: PWA-ready design.

## Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    Ensure `.env` exists with:
    ```
    VITE_SUPABASE_URL=...
    VITE_SUPABASE_ANON_KEY=...
    ```

3.  **Run Development Server**:
    ```bash
    npm run dev
    ```

4.  **Database Setup**:
    The application requires a `queues` table and `next_ticket` function (already set up via SQL).

## Deployment

Build for production:
```bash
npm run build
```
