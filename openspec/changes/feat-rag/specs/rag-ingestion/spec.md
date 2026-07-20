## ADDED Requirements

### Requirement: Document file upload
The system SHALL support uploading PDF and DOCX documents with size up to 20MB and process them asynchronously.

#### Scenario: Successful upload
- **WHEN** a document file (PDF or DOCX) is uploaded
- **AND** the file size is under 20MB
- **THEN** the system stores the file in Vercel Blob
- **AND** creates a document resource row with status "pending"
- **AND** returns the resource ID and "pending" status immediately
- **AND** triggers the ingestion pipeline asynchronously

#### Scenario: File size limit exceeded
- **WHEN** a document file is uploaded
- **AND** the file size exceeds 20MB
- **THEN** the upload request is rejected with an error

### Requirement: Status polling and UI gating
The system SHALL provide a status endpoint for the frontend to poll ingestion status and gate the chat input accordingly.

#### Scenario: Ingestion status endpoint
- **WHEN** a GET request is made to the document status endpoint with a resource ID
- **THEN** the system returns the current status of the resource

#### Scenario: Send button gating
- **WHEN** a document resource status is "pending"
- **THEN** the chat input send button is disabled
- **AND** the frontend polls the status endpoint every 2 seconds

#### Scenario: Ingestion failure handling
- **WHEN** a document resource status transitions to "error"
- **THEN** the frontend displays an error message
- **AND** removes the attachment
- **AND** re-enables the send button

### Requirement: Ingestion pipeline execution
The system SHALL orchestrate document parsing, chunking, embedding, and storage.

#### Scenario: Ingestion pipeline success
- **WHEN** async ingestion begins
- **THEN** the system uploads the document to LlamaCloud for agentic parsing
- **AND** splits the parsed markdown into chunks on paragraph boundaries
- **AND** embeds each chunk using Zhipu embedding-3 (1024 dims)
- **AND** stores chunks in the database
- **AND** updates the resource status to "ready"

#### Scenario: Ingestion pipeline failure
- **WHEN** any step in the parsing, chunking, embedding, or database storage fails
- **THEN** the resource status is updated to "error"
- **AND** partial ingestion chunks are not persisted in the database
