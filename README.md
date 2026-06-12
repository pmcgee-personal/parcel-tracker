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
                                       ──►  Returns all tracked shipments

  CloudFront ──► S3 Bucket ──► Frontend dashboard
```

---

## Project Structure

```
parcel-tracker/
├── .github/workflows/       # CI/CD workflows (GitHub Actions)
├── events/                  # Sample JSON payloads for local Lambda testing
├── frontend/                # Static frontend dashboard (HTML/CSS/JS)
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

| Method | Path       | Function        | Description                      |
| ------ | ---------- | --------------- | -------------------------------- |
| POST   | `/webhook` | WebhookFunction | Ingests a carrier tracking event |
| POST   | `/track`   | TrackFunction   | Registers a new tracking number  |
| GET    | `/track`   | ListFunction    | Returns all tracked shipments    |

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
  --secret-string '{"apiKey":"your-key-here"}'
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

## Background

This project grew out of a broader interest in connecting ShipStation's webhook infrastructure to a real tracking UI. It was built incrementally as a learning exercise in AWS SAM, serverless patterns, and API integration — with real ShipStation payloads used during development.
