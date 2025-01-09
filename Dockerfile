
FROM metisdao/dtl:v0.2.0

WORKDIR /opt/optimism/packages/data-transport-layer

COPY sequencer-batch-inbox.js dist/src/services/l1-ingestion/handlers/sequencer-batch-inbox.js

