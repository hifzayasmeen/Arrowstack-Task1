# B2B Order Management Platform: Backend API (Arrowstack Task 1)

A secure REST API backend for a B2B order management platform, built with Node.js, Express, and PostgreSQL. It uses JWT authentication, hashed passwords, and standard security middleware, and the database schema is managed through SQL migrations.

## Tech Stack

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| Runtime        | Node.js (CommonJS)                      |
| Framework      | Express 4                               |
| Database       | PostgreSQL (`pg`)                       |
| Auth           | JSON Web Tokens (`jsonwebtoken`)        |
| Password hash  | `bcryptjs`                              |
| Security       | `helmet`, `cors`, `express-rate-limit`  |
| Config         | `dotenv`                                |
| Testing        | Node's built-in test runner (`node --test`) |
| Deployment     | Docker                                  |

## Project Structure

```
Arrowstack-Task1/
├── migrations/        # SQL migration files
├── src/               # Application source (server, routes, db scripts)
├── tests/             # Automated tests (*.test.js)
├── .env.example       # Example environment variables
├── .dockerignore
├── Dockerfile
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18 or later
- PostgreSQL 13 or later
- npm

### 1. Clone and install

```bash
git clone https://github.com/hifzayasmeen/Arrowstack-Task1.git
cd Arrowstack-Task1
npm install
```

### 2. Configure environment

Copy the example file and fill in your own values:

```bash
cp .env.example .env
```

| Variable         | Description                          | Example                                              |
| ---------------- | ------------------------------------ | ---------------------------------------------------- |
| `PORT`           | Port the API listens on              | `4000`                                               |
| `DATABASE_URL`   | PostgreSQL connection string         | `postgres://b2b_user:b2b_pass@localhost:5432/b2b_orders` |
| `JWT_SECRET`     | Secret used to sign tokens           | a long random string                                 |
| `JWT_EXPIRES_IN` | Token lifetime                       | `8h`                                                 |

> Never commit your real `.env` file. Use a long, random `JWT_SECRET` in production.

### 3. Set up the database

Create the database and user in PostgreSQL, then run the migrations and (optionally) seed data:

```bash
npm run migrate
npm run seed
```

### 4. Run the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:4000`.

## Available Scripts

| Script            | What it does                          |
| ----------------- | ------------------------------------- |
| `npm start`       | Start the server                      |
| `npm run dev`     | Start with nodemon (auto-reload)      |
| `npm run migrate` | Apply database migrations             |
| `npm run seed`    | Seed the database with sample data    |
| `npm test`        | Run the test suite                    |

## Run with Docker

```bash
docker build -t b2b-order-backend .
docker run -p 4000:4000 --env-file .env b2b-order-backend
```

Make sure `DATABASE_URL` points to a PostgreSQL instance that the container can reach.

## Security Features

- Password hashing with bcrypt
- Stateless JWT authentication with configurable expiry
- Secure HTTP headers via Helmet
- Rate limiting to protect against brute-force and abuse
- CORS configuration
- Secrets loaded from environment variables

## Testing

```bash
npm test
```

## Author

**Hifza Yasmeen**
GitHub: [@hifzayasmeen](https://github.com/hifzayasmeen)

## License

This project was built as part of the Arrowstack program.
