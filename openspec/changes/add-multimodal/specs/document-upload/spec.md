## ADDED Requirements

### Requirement: XLSX files can be uploaded and ingested

The system SHALL accept `.xlsx` (Excel) files via the file upload endpoint and process them through the RAG ingestion pipeline.

#### Scenario: Upload XLSX file

- **WHEN** user uploads a valid `.xlsx` file under 20MB
- **THEN** the file is stored successfully and a document resource record is created
- **AND** the file content is parsed, chunked, embedded, and stored for retrieval

### Requirement: PPTX files can be uploaded and ingested

The system SHALL accept `.pptx` (PowerPoint) files via the file upload endpoint and process them through the RAG ingestion pipeline.

#### Scenario: Upload PPTX file

- **WHEN** user uploads a valid `.pptx` file under 20MB
- **THEN** the file is stored successfully and a document resource record is created
- **AND** the file content is parsed, chunked, embedded, and stored for retrieval

### Requirement: TXT files can be uploaded and ingested

The system SHALL accept `.txt` (plain text) files via the file upload endpoint and process them through the RAG ingestion pipeline.

#### Scenario: Upload TXT file

- **WHEN** user uploads a valid `.txt` file under 20MB
- **THEN** the file is stored successfully and a document resource record is created
- **AND** the file content is parsed, chunked, embedded, and stored for retrieval

### Requirement: New document types appear in frontend accept list

The system SHALL include XLSX, PPTX, and TXT MIME types in the file input accept attribute and upload validation.

#### Scenario: File picker shows new types

- **WHEN** user opens the file picker from the chat input
- **THEN** XLSX, PPTX, and TXT files are selectable alongside existing PDF and DOCX options
