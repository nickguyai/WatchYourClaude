# Watch Your Claude

**Watch Your Claude is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Anthropic PBC.**

A minimalistic OTEL telemetry exporter for Claude Code with Japanese art-inspired UI.

## Prerequisites

- Node.js (v14 or higher)
- npm
- Supabase account (for historical data storage)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/watch-your-claude-otel.git
cd watch-your-claude-otel
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Supabase Database

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. In your Supabase dashboard, go to the SQL Editor
3. Run the SQL scripts in order:
   - First: `instructions/database-schema.sql` - Creates the base tables and structure
   - Then: `instructions/database-functions-triggers.sql` - Adds functions, triggers, and indexes
   
   This will create:
   - Required tables (`metrics`, `daily_summary`)
   - Functions and triggers for automatic data aggregation
   - Indexes for performance optimization

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```bash
SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key
PORT=2025  # Optional, defaults to 2025
```

### 5. Start the Server

Use the provided restart script:

```bash
./restart-server.sh
```

Or manually:

```bash
npm start
```

### 6. Configure Claude Code

Add the following to your Claude Code `settings.json`:

```json
{
  "model": "opus",
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:2025",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_METRIC_EXPORT_INTERVAL": "3000",
    "OTEL_LOGS_EXPORT_INTERVAL": "3000",
    "OTEL_LOG_USER_PROMPTS": "1",
    "OTEL_METRICS_INCLUDE_ACCOUNT_UUID": "false"
  }
}
```

### 7. Access the Dashboard

Open http://localhost:2025 in your browser

## Features

- **Real-time Metrics**: Live updates via WebSocket
- **Zen-inspired UI**: Japanese art style with Ukiyo-e color palette
- **OTLP Compatible**: Standard OpenTelemetry protocol support
- **Tracked Metrics**:
  - `claude_code.cost.usage` - API usage costs
  - `claude_code.token.usage` - Token consumption (with type breakdown)
  - `claude_code.lines_of_code.count` - Code modifications
  - `claude_code.lines_of_code.added` - Lines added
  - `claude_code.lines_of_code.removed` - Lines removed
  - `claude_code.session.count` - Active sessions
  - `claude_code.code_edit_tool.decision` - Edit tool decisions
- **Supabase Integration**: Historical data storage and trend analysis
- **Token Details Modal**: View token usage breakdown by type

## API Endpoints

- `POST /v1/metrics` - OTLP metrics ingestion
- `GET /api/metrics` - Query stored metrics
- `GET /api/metrics/summary` - Get metrics summary
- `GET /health` - Health check

## Development

```bash
npm run dev  # Start with auto-reload
```

## Troubleshooting

### Port Already in Use

If port 2025 is already in use, the restart script will automatically kill the existing process. Alternatively:

```bash
lsof -ti:2025 | xargs kill -9
```

### No Metrics Showing

1. Ensure Claude Code telemetry is enabled in settings
2. Check that the server is running (`./restart-server.sh`)
3. Verify Supabase credentials in `.env` file
4. Check browser console for errors

### Database Connection Issues

1. Verify your Supabase URL and anon key are correct
2. Ensure your Supabase project is active
3. Check that the database tables were created successfully

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Uses OpenTelemetry protocol for metrics collection
- Japanese art-inspired UI design
- Built with Express.js and Socket.IO for real-time updates