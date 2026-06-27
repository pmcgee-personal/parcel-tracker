# parcel-tracker

A personal shipment tracking dashboard for inbound and outbound packages. Built as a serverless application on AWS using SAM, it ingests real carrier webhook events, stores a full event timeline, and serves a lightweight frontend dashboard via CloudFront.

---

## Overview

This project was built as a learning project and personal tool, combining real ShipStation webhook payloads with AWS serverless infrastructure. It lets you register tracking numbers, receive live carrier updates, and view the full event history for every shipment in a simple React-style frontend.

**Stack:**

- AWS Lambda (Node.js 22.x) — three discrete handlers for ingestion, tracking, and listing
- Amazon API Gateway — REST API with CORS enabled
- Amazon DynamoDB — two tables: `Shipments` and `Events`
- AWS Secrets Manager — stores the ShipStation API key
- Amazon S3 + CloudFront — hosts the frontend dashboard with HTTPS redirect
- React + Vite + Tailwind CSS — responsive, component-based frontend UI

## Key Features

- **Unified Dashboard**: View both Inbound and Outbound shipments in a single interface.
- **Smart Filtering**: Automatically hides "Delivered" packages after 3 days to keep the dashboard clutter-free, with a toggle to view the full history.
- **Expandable Timelines**: Click on any shipment to reveal a dynamically sorted dropdown containing its full event history and geographic routing.
- **Quick Registration**: Instantly add new tracking numbers (USPS, UPS, FedEx) directly from the UI control panel.
- **Real-Time Webhooks**: Backend automatically processes carrier push events to keep the DynamoDB tables and frontend up-to-date.

---

## Architecture

```
Carrier / ShipStation
        │
        ▼
  POST /webhook  ──►  WebhookFunction  ──►  Events table (timeline)
                                       ──►  Shipments table (latest status)

  POST /track    ──►  TrackFunction    ──►  Fetches initial status via ShipStation API
                                       ──►  Writes to both tables

  GET  /track    ──►  ListFunction     ──►  Reads Shipments table
                                       ──►  Reads Events table
                                       ──►  Joins data & returns nested shipments

  CloudFront ──► S3 Bucket ──► Frontend dashboard
```

---

## Project Structure

```
parcel-tracker/
├── .github/workflows/       # CI/CD workflows (GitHub Actions)
├── events/                  # Sample JSON payloads for local Lambda testing
├── frontend/                # React/Vite/Tailwind SPA dashboard
├── src/
│   └── handlers/
│       ├── webhook/         # Ingests carrier tracking updates (POST /webhook)
│       ├── track/           # Registers a new tracking number (POST /track)
│       └── list/            # Returns all shipments for the dashboard (GET /track)
├── .gitignore
├── samconfig.toml           # SAM deployment configuration
└── template.yaml            # AWS SAM infrastructure definition
```

---

## DynamoDB Tables

### `Shipments`

Stores high-level shipment details.

| Attribute        | Type   | Role        |
| ---------------- | ------ | ----------- |
| `trackingNumber` | String | Primary key |

### `Events`

Stores the full timeline of tracking events per shipment.

| Attribute        | Type   | Role          |
| ---------------- | ------ | ------------- |
| `trackingNumber` | String | Partition key |
| `occurredAt`     | String | Sort key      |

Both tables have `DeletionPolicy: Retain` — they survive stack teardown.

---

## Prerequisites

- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- [Node.js 22](https://nodejs.org/en/)
- [Docker](https://hub.docker.com/search/?type=edition&offering=community) (for local testing)
- An AWS account with appropriate IAM permissions
- A ShipStation API key stored in AWS Secrets Manager under the path `ParcelTracker/ShipStationApiKey`

---

## Deployment

### First-time deploy

```bash
sam build
sam deploy --guided
```

The `--guided` flag walks you through stack name, region, and IAM capability prompts. Answers are saved to `samconfig.toml` so subsequent deploys just need:

```bash
sam build && sam deploy
```

### Deploy the frontend

After deploying the backend, upload the frontend to the S3 bucket created by the stack:

```bash
aws s3 sync frontend/ s3://<FrontendBucketName> --delete
```

Then invalidate the CloudFront cache if needed:

```bash
aws cloudfront create-invalidation --distribution-id <CloudFrontDistributionId> --paths "/*"
```

Stack outputs include `FrontendBucketName`, `CloudFrontDistributionId`, and `CloudFrontDomainName`.

---

## API Endpoints

All endpoints are available under the API Gateway `Prod` stage. URLs are printed in stack outputs after deployment.

| Method | Path       | Function        | Description                      | Auth                       |
| ------ | ---------- | --------------- | -------------------------------- | -------------------------- |
| POST   | `/webhook` | WebhookFunction | Ingests a carrier tracking event | ShipEngine RSA signature   |
| POST   | `/track`   | TrackFunction   | Registers a new tracking number  | API key (`x-api-key`)      |
| GET    | `/track`   | ListFunction    | Returns all tracked shipments    | API key (`x-api-key`)      |

### Authentication

- **`/webhook`** verifies the `x-shipengine-rsa-sha256-*` signature headers against ShipEngine's published JWKS (`https://api.shipengine.com/jwks`). Requests with missing/invalid signatures or stale timestamps (>5 min) are rejected. For local testing with unsigned payloads, set `WEBHOOK_VERIFY_DISABLED=true` (local only — never in a deployment).
- **`/track`** (GET + POST) requires an API key, enforced via an API Gateway usage plan that also throttles and quota-limits requests to protect the paid ShipEngine quota. The key is generated on deploy and exposed (by ID) via the `ApiKeyId` stack output.

  - **CI deploys** (`.github/workflows/deploy.yml`): handled automatically — the workflow reads `ApiKeyId` from the stack, resolves the value, and builds the frontend with `VITE_API_KEY`. Just push to `main`.
  - **Local dev** (`npm run dev`): fetch the value once and put it in `frontend/.env.local` as `VITE_API_KEY=...`:

    ```bash
    aws apigateway get-api-key \
      --api-key <ApiKeyId-from-stack-output> \
      --include-value --query value --output text
    ```

  Note: because the SPA is public, this key is visible to anyone using the dashboard — it is an abuse/throttle control, not a true secret.

---

## Local Development & Testing

Build locally:

```bash
sam build
```

Invoke a function with a test event:

```bash
sam local invoke WebhookFunction --event events/event.json
sam local invoke TrackFunction --event events/event.json
```

Start the full API locally on port 3000:

```bash
sam local start-api
```

Test with curl:

```bash
curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -d @events/event.json
curl http://localhost:3000/track
```

---

## Secrets

The TrackFunction reads the ShipStation API key from AWS Secrets Manager. Before deploying, create the secret:

```bash
aws secretsmanager create-secret \
  --name "ParcelTracker/ShipStationApiKey" \
  --secret-string '{"ShipStationApiKey":"your-key-here"}'
```

The Lambda is granted `AWSSecretsManagerGetSecretValuePolicy` scoped to this exact secret ARN.

---

## Logs

Tail live Lambda logs from the command line:

```bash
sam logs -n WebhookFunction --stack-name parcel-tracker --tail
sam logs -n TrackFunction --stack-name parcel-tracker --tail
```

---

## Cleanup

To tear down the stack (DynamoDB tables are retained by design):

```bash
sam delete --stack-name parcel-tracker
```

To also remove the tables, delete them manually in the AWS Console or via CLI after the stack is gone.

---

### CI/CD Pipeline

This repository includes GitHub Actions workflows (`.github/workflows/`) that automatically build, test, and deploy the AWS SAM backend and sync the React frontend to S3/CloudFront on push to the main branch.

---

## Background

This project grew out of a broader interest in connecting ShipStation's webhook infrastructure to a real tracking UI. It was built incrementally as a learning exercise in AWS SAM, serverless patterns, and API integration — with real ShipStation payloads used during development.
