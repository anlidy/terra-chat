## ADDED Requirements

### Requirement: Model can invoke image generation tool

The system SHALL provide a `generateImage` tool that the chat model can invoke to create images based on user descriptions. The tool SHALL accept a prompt, optional negative prompt, and optional size parameter.

#### Scenario: Model generates an image from user request

- **WHEN** user asks the model to "draw a picture of a sunset over mountains"
- **THEN** the model invokes the `generateImage` tool with an appropriate prompt
- **AND** the generated image is displayed in the chat

### Requirement: Image generation result is streamed as imageDelta

The system SHALL stream the generated image URL back to the client using the `imageDelta` data stream type.

#### Scenario: Image generation result appears in chat

- **WHEN** the image generation tool completes successfully
- **THEN** the generated image URL is written to the data stream as an `imageDelta`
- **AND** the image is rendered in the chat message

### Requirement: Image generation handles errors gracefully

The system SHALL return an error message in the chat when image generation fails, without crashing the conversation.

#### Scenario: Image generation API failure

- **WHEN** the external image generation API returns an error
- **THEN** the tool returns an error message describing the failure
- **AND** the conversation continues without interruption

### Requirement: Image generation respects timeout

The system SHALL time out image generation requests after 60 seconds.

#### Scenario: Image generation timeout

- **WHEN** the image generation API takes longer than 60 seconds
- **THEN** the tool returns a timeout error to the user
