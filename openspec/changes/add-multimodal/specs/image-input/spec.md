## ADDED Requirements

### Requirement: User can upload images via file picker

The system SHALL allow users to select image files from their device using a file picker dialog. Supported formats are image/jpeg, image/png, image/gif, and image/webp.

#### Scenario: Single image upload via file picker

- **WHEN** user clicks the attachment button and selects a JPEG or PNG image
- **THEN** the image is uploaded to storage and displayed as a thumbnail preview in the input area

#### Scenario: Multiple image upload via file picker

- **WHEN** user selects multiple images in the file picker
- **THEN** all images are uploaded concurrently and displayed as thumbnail previews

### Requirement: User can upload images via paste

The system SHALL allow users to paste images from the clipboard directly into the chat input textarea.

#### Scenario: Paste clipboard image

- **WHEN** user pastes clipboard content containing an image
- **THEN** the image is uploaded to storage and displayed as a thumbnail preview in the input area

### Requirement: User can upload images via drag and drop

The system SHALL allow users to drag image files from their file manager and drop them into the chat input area.

#### Scenario: Drag and drop single image

- **WHEN** user drags an image file onto the chat input area and releases
- **THEN** the image is uploaded to storage and displayed as a thumbnail preview

#### Scenario: Drag and drop multiple images

- **WHEN** user drags multiple image files onto the chat input area and releases
- **THEN** all images are uploaded concurrently and displayed as thumbnail previews

### Requirement: Model receives image content in vision-capable format

The system SHALL download uploaded image URLs server-side, resize images exceeding 2048px on the longest side, encode them as base64 data URLs (`data:image/...;base64,...`), and include them in the model request in a format compatible with OpenAI-compatible vision APIs.

#### Scenario: Image reaches vision model

- **WHEN** user sends a message with an image attachment to a vision-capable model
- **THEN** the model receives the image as a properly encoded content part and can describe or analyze the image

#### Scenario: No image download failure

- **WHEN** an uploaded image URL is no longer accessible
- **THEN** the system SHALL return an error to the user indicating the image could not be processed

### Requirement: Unsupported image formats are rejected

The system SHALL reject image formats not in the supported list with a clear error message.

#### Scenario: Unsupported format rejection

- **WHEN** user attempts to upload a BMP, TIFF, or SVG image
- **THEN** the system returns an error message indicating the format is not supported
