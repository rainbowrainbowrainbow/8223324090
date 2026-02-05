---
name: cc-nano-banana
description: Generate and edit images using Gemini CLI's Nano Banana extension
version: 1.0.0
source: https://github.com/kkoppenhaver/cc-nano-banana
triggers:
  - generate image
  - create image
  - edit image
  - nano banana
  - image generation
  - thumbnail
  - icon
  - diagram
  - pattern
  - illustration
---

# Nano Banana Image Generation

Handle all image generation requests including blog images, thumbnails, icons, diagrams, patterns, illustrations, photos, visual assets, graphics, artwork, and pictures.

## Prerequisites

Before first use, verify setup:

1. **Gemini CLI** must be installed:
   ```bash
   npm install -g @anthropic-ai/gemini-cli
   ```

2. **GEMINI_API_KEY** environment variable must be set:
   ```bash
   export GEMINI_API_KEY="your-api-key"
   ```

3. **nanobanana extension** must be installed:
   ```bash
   gemini extensions install https://github.com/gemini-cli-extensions/nanobanana
   ```

Verify: `gemini --check-extensions`

## Commands

### `/generate` — Text to Image
```bash
gemini --yolo -m gemini-2.5-flash-image "generate an image of [description]"
```

### `/edit` — Modify Existing Image
```bash
gemini --yolo -m gemini-2.5-flash-image "edit this image: [path] — [changes]"
```

### `/restore` — Repair Damaged Photos
```bash
gemini --yolo -m gemini-2.5-flash-image "restore this damaged photo: [path]"
```

### `/icon` — Generate App Icons
```bash
gemini --yolo -m gemini-2.5-flash-image "create an icon for [description]"
```

### `/diagram` — Create Flowcharts & Diagrams
```bash
gemini --yolo -m gemini-2.5-flash-image "create a diagram showing [description]"
```

### `/pattern` — Generate Seamless Patterns
```bash
gemini --yolo -m gemini-2.5-flash-image "create a seamless pattern of [description]"
```

### `/story` — Sequential Image Generation
```bash
gemini --yolo -m gemini-2.5-flash-image "create a [N]-panel story about [description]"
```

## Options

| Option | Description |
|--------|-------------|
| `--yolo` | **Required.** Auto-approve all tool actions |
| `--count=N` | Generate N variations (1-8) |
| `-m MODEL` | Specify model (default: gemini-2.5-flash-image) |

## Models

| Model | Quality | Cost |
|-------|---------|------|
| `gemini-2.5-flash-image` | Fast, good quality | ~$0.04/image |
| `gemini-3-pro-image-preview` | Higher quality | Higher cost |

## Common Sizes

| Use Case | Size |
|----------|------|
| YouTube Thumbnail | 1280x720 |
| Blog Header | 1200x630 |
| Social Media Square | 1080x1080 |
| Instagram Story | 1080x1920 |
| App Icon | 1024x1024 |

## Output

All generated images are saved to `./nanobanana-output/` directory.

## Workflow

1. **Generate**: Create image with specific prompt and style
2. **Review**: Show user the generated image(s)
3. **Refine**: If needed, regenerate with adjusted prompt or edit existing output
4. **Deliver**: Present final image(s) from output directory

## Best Practices

- Be specific in prompts (include style, lighting, composition, color palette)
- Use `--count=3` to generate variations for comparison
- For pro quality, use `gemini-3-pro-image-preview` model
- Iterative refinement: generate → review → adjust prompt → regenerate
