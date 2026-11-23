# RentPro – Backend API

RentPro is the backend API for the RentPro Equipment Rental Platform. It powers authentication, equipment management, booking operations, payment processing, role-based authorization, and administrative functionality.

## Features

- **Authentication:** Verify BetterAuth JWT tokens.
- **Role-Based Authorization:** Protect routes for Customers, Owners, and Admins.
- **Equipment Management:** Create, update, retrieve, and manage equipment listings.
- **Equipment Search & Filtering:** Search equipment by name, category, location, price range, and availability.
- **Booking Management:** Handle rental bookings, booking status, and rental history.
- **Favorites:** Manage customers' favorite equipment.
- **Stripe Integration:** Create Stripe Checkout Sessions and process successful payments.
- **Stripe Webhooks:** Verify payment events and save booking and payment records.
- **Admin Management:** Manage users, equipment approvals, and rental records.
- **Analytics:** Provide platform statistics, revenue, booking data, and owner earnings.

## Technologies Used

- Node.js
- Express.js
- MongoDB
- JavaScript
- BetterAuth
- JSON Web Token (JWT)
- JOSE
- Stripe

## Database Collections

The backend uses MongoDB with the following collections:

| Collection | Purpose |
|---|---|
| `user` | Stores user information and roles |
| `equipment` | Stores equipment listings |
| `bookings` | Stores rental booking records |
| `favorites` | Stores customer favorite equipment |
| `payments` | Stores payment transactions |

## Project Structure

```text
server/
├── index.js
├── package.json
├── .env
└── README.md
```

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Node.js
- npm
- MongoDB database
- Stripe account
- RentPro client application

### Installation

Clone the backend repository:

```bash
git clone YOUR_SERVER_REPOSITORY_URL
```

Navigate to the server directory:

```bash
cd server
```

Install dependencies:

```bash
npm install
```

## Environment Variables

Create a `.env` file in the server root directory.

Configure the required environment variables:

```env
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
BETTER_AUTH_URL=YOUR_BETTER_AUTH_URL
MONGODB_URL=YOUR_MONGODB_CONNECTION_STRING
```

Replace the placeholder values with your actual credentials.

**Important:** Never commit your `.env` file or expose secret credentials publicly.

## Run the Server

Start the development server using the command configured in `package.json`.

```bash
npm run dev
```

If no development script exists, run:

```bash
node index.js
```

The local API server runs at:

`http://localhost:5000`

## API Overview

The backend provides API endpoints for:

| Module | Functionality |
|---|---|
| Authentication | JWT verification and role-based authorization |
| Equipment | Equipment CRUD, search, and filtering |
| Bookings | Rental requests and booking management |
| Favorites | Add, retrieve, and remove favorites |
| Admin Users | User listing and role management |
| Admin Equipment | Equipment approval and management |
| Admin Rentals | Rental monitoring and status management |
| Analytics | Admin and owner statistics |
| Payments | Stripe Checkout and payment processing |
| Webhooks | Stripe payment event processing |

## Authorization

The backend uses BetterAuth JWT verification and role-based middleware.

Supported roles:

- `customer`
- `owner`
- `admin`

Protected endpoints require a valid authorization token. Access is restricted according to the user's assigned role.

## Payment Processing

RentPro uses Stripe Checkout for online rental payments.

After a successful payment, the Stripe webhook processes the `checkout.session.completed` event and saves the booking and payment information in MongoDB.

## Client Integration

The Next.js client communicates with this backend through the API base URL configured in:

```env
NEXT_PUBLIC_API_BASE_URL=YOUR_SERVER_API_URL
```

For local development:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
```

## Live Deployment

- **Backend API:** https://equipment-rental-platform-server-topaz.vercel.app
- **Frontend Website:** https://equipment-rental-platform-seven.vercel.app

## Developer

Backend developed as part of the RentPro Equipment Rental Platform using Express.js, MongoDB, BetterAuth, and Stripe.
