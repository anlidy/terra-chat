## ADDED Requirements

### Requirement: Proactive retrieval
The system SHALL proactively retrieve relevant document chunks before streaming a response when the chat has ready documents.

#### Scenario: Proactive retrieval injection
- **WHEN** a chat response request is received
- **AND** the chat has at least one document with ready status
- **THEN** the system embeds the last user message
- **AND** retrieves the top 5 chunks via cosine similarity search
- **AND** injects the chunks into the system prompt using a ragContextPrompt block

### Requirement: Tool-based retrieval interface
The system SHALL provide a retrieveDocuments tool for the model to retrieve documents.

#### Scenario: Tool execution
- **WHEN** the model invokes the retrieveDocuments tool with a query
- **THEN** the system embeds the query
- **AND** retrieves the top 5 chunks filtered by the current chat_id
- **AND** returns an array of chunks containing content, fileName, and chunkIndex

### Requirement: Retrieval availability gate
The system SHALL only enable retrieval mechanisms when the chat has ready documents.

#### Scenario: No ready documents
- **WHEN** a chat has no documents with ready status
- **THEN** proactive retrieval is bypassed
- **AND** the retrieveDocuments tool is not active
