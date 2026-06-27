# parcel-tracker

A personal shipment tracking dashboard for inbound and outbound packages. Built as a serverless application on AWS using SAM, it ingests real carrier webhook events, stores a full event timeline, and serves a lightweight frontend dashboard via CloudFront.

---

## Overview

This project was built as a learning project and personal tool, combining real ShipStation webhook payloads with AWS serverless infrastructure. It lets you register tracking numbers, receive live carrier updates, and view the full event history for every shipment in a simple React-style frontend.

**Stack:**

- AWS Lambda (Node.js 22.x) — three discrete handlers for ingestion, tracking, and listing, sharing a small `src/lib` of helper modules
- Amazon API Gateway — REST API with CORS, an API key + usage plan on `/track`, and RSA signature verification on `/webhook`
- Amazon DynamoDB — two on-demand (`PAY_PER_REQUEST`) tables: `Shipments` and `Events`
- AWS Secrets Manager — stores the ShipStation API key
- Amazon S3 + CloudFront — hosts the frontend dashboard with HTTPS redirect
- React + Vite + Tailwind CSS — responsive single-page dashboard
- Backend unit tests with Node's built-in test runner (`node --test`), run as a CI gate before deploy

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
│   ├── handlers/
│   │   ├── webhook/         # Ingests carrier tracking updates (POST /webhook)
│   │   ├── track/           # Registers a new tracking number (POST /track)
│   │   └── list/            # Returns all shipments for the dashboard (GET /track)
│   └── lib/                 # Shared helpers used by the handlers
│       ├── ddb.js           #   DynamoDB client, table names, batchWrite
│       ├── batch.js         #   SDK-free BatchWrite chunking/retry logic
│       ├── events.js        #   mapTrackingEvent — Events-table item builder
│       ├── dates.js         #   getDateOnly / getLocalDateString (timezone)
│       └── verifyShipEngineSignature.js  # RSA webhook signature verification
├── test/                    # Backend unit tests (node --test)
├── .gitignore
├── package.json             # Root: backend test script (no runtime deps)
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

Both tables use on-demand billing (`BillingMode: PAY_PER_REQUEST`) so they self-scale with traffic, and both have `DeletionPolicy: Retain` — they survive stack teardown.

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

> In practice this is automated — pushing to `main` runs `.github/workflows/deploy.yml`, which deploys the backend, then builds and uploads the frontend with the right API URL and key. The steps below are the manual equivalent.

After deploying the backend, build the frontend (injecting the API base URL and key from the stack outputs) and upload the built `dist/` to the S3 bucket:

```bash
cd frontend
API_URL=$(aws cloudformation describe-stacks --stack-name parcel-tracker-stack --query "Stacks[0].Outputs[?OutputKey=='ListApiUrl'].OutputValue" --output text)
API_KEY_ID=$(aws cloudformation describe-stacks --stack-name parcel-tracker-stack --query "Stacks[0].Outputs[?OutputKey=='ApiKeyId'].OutputValue" --output text)
API_KEY=$(aws apigateway get-api-key --api-key "$API_KEY_ID" --include-value --query value --output text)

npm ci
VITE_API_BASE_URL=$API_URL VITE_API_KEY=$API_KEY npm run build
aws s3 sync dist/ s3://<FrontendBucketName> --delete
```

Then invalidate the CloudFront cache if needed:

```bash
aws cloudfront create-invalidation --distribution-id <CloudFrontDistributionId> --paths "/*"
```

Stack outputs include `FrontendBucketName`, `CloudFrontDistributionId`, `CloudFrontDomainName`, and `ApiKeyId`.

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
# The sample payload is unsigned, so disable webhook signature verification
# for local runs (see env.json with {"WebhookFunction": {"WEBHOOK_VERIFY_DISABLED": "true"}}).
sam local invoke WebhookFunction --event events/event.json --env-vars env.json
sam local invoke TrackFunction --event events/event.json
```

Start the full API locally on port 3000:

```bash
sam local start-api --env-vars env.json
```

Test with curl:

```bash
curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -d @events/event.json
curl http://localhost:3000/track
```

> **Note:** `WEBHOOK_VERIFY_DISABLED=true` is for local testing only — never set it in a deployment, or the webhook will accept unsigned (forged) requests.

### Backend tests

The shared `src/lib` modules are covered by unit tests using Node's built-in test runner (no dependencies to install):

```bash
npm test        # or: node --test
```

These run automatically in CI before any deploy, so a failing test blocks the deployment.

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

## Push Notifications

The webhook handler sends push notifications via [ntfy](https://ntfy.sh/) on delivery, exception, and out-for-delivery events. Configuration:

- **`NtfyUrl`** — the ntfy channel URL, passed as a CloudFormation parameter (`NoEcho`), injected from the `NTFY_URL` GitHub secret in CI.
- **`APP_TIMEZONE`** — timezone used to decide the "calendar day" for the once-per-day out-for-delivery dedup (default `America/Los_Angeles`, set in `template.yaml`). Lambda runs in UTC, so this prevents a late-evening event from being attributed to the next day.

---

## Logs

Tail live Lambda logs from the command line:

```bash
sam logs -n WebhookFunction --stack-name parcel-tracker-stack --tail
sam logs -n TrackFunction --stack-name parcel-tracker-stack --tail
```

---

## Cleanup

To tear down the stack (DynamoDB tables are retained by design):

```bash
sam delete --stack-name parcel-tracker-stack
```

To also remove the tables, delete them manually in the AWS Console or via CLI after the stack is gone.

---

### CI/CD Pipeline

`.github/workflows/deploy.yml` runs on every push to `main` and performs, in order:

1. **Backend tests** (`node --test`) — a gate; a failing test stops the deploy.
2. **`sam build` + `sam deploy`** to the `parcel-tracker-stack` stack (the `NtfyUrl` parameter is injected from the `NTFY_URL` GitHub secret).
3. **Frontend build + sync** — reads the stack outputs (`ListApiUrl`, `FrontendBucketName`, `CloudFrontDistributionId`, `ApiKeyId`), resolves the API key value, builds the SPA with `VITE_API_BASE_URL`/`VITE_API_KEY`, syncs to S3, and invalidates CloudFront.

Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `NTFY_URL`.

---

## Background

This project grew out of a broader interest in connecting ShipStation's webhook infrastructure to a real tracking UI. It was built incrementally as a learning exercise in AWS SAM, serverless patterns, and API integration — with real ShipStation payloads used during development.
