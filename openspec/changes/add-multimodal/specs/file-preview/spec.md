## ADDED Requirements

### Requirement: Image attachments show thumbnail preview

The system SHALL display image attachments as 64x64 pixel thumbnail previews using the actual image content.

#### Scenario: Image thumbnail in input area

- **WHEN** an image file is attached in the chat input
- **THEN** a 64x64 thumbnail of the image is displayed with the filename overlay

#### Scenario: Image thumbnail in message history

- **WHEN** a message contains an image attachment from a previous turn
- **THEN** the image is displayed as a 64x64 thumbnail in the message bubble

### Requirement: Image lightbox for full-size viewing

The system SHALL provide a lightbox overlay to view attached images at full resolution when clicked.

#### Scenario: Open image in lightbox

- **WHEN** user clicks on an image thumbnail in a message or input preview
- **THEN** a lightbox overlay opens displaying the image at full size
- **AND** the lightbox can be closed with a close button or Escape key

### Requirement: Document attachments show type-specific icons

The system SHALL display type-specific file icons for non-image attachments based on their MIME type.

#### Scenario: PDF file shows PDF icon

- **WHEN** a PDF file is attached
- **THEN** a PDF-specific icon is displayed instead of a generic "File" placeholder

#### Scenario: DOCX file shows document icon

- **WHEN** a DOCX file is attached
- **THEN** a document-specific icon is displayed

#### Scenario: XLSX file shows spreadsheet icon

- **WHEN** an XLSX file is attached
- **THEN** a spreadsheet-specific icon is displayed

#### Scenario: PPTX file shows presentation icon

- **WHEN** a PPTX file is attached
- **THEN** a presentation-specific icon is displayed

#### Scenario: TXT file shows text icon

- **WHEN** a TXT file is attached
- **THEN** a text-specific icon is displayed

### Requirement: Filename is visible on all previews

The system SHALL display the filename as an overlay on all attachment previews regardless of type.

#### Scenario: Filename shown on preview

- **WHEN** any file is attached
- **THEN** the filename is visible as a text overlay at the bottom of the preview thumbnail
