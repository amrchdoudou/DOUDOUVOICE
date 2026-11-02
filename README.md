# DoudouVoice 🎙️

**AI-powered voice generation for Arabic dialects and creative video production.**

DoudouVoice is an AI-powered platform designed to transform text into natural, expressive speech across multiple Arabic dialects and languages. It also includes an experimental AI Video Creator that helps users turn images, video clips, and creative instructions into commercial-style videos.

## ✨ Features

### 🎙️ AI Voice Studio

- Generate speech from text using AI-powered text-to-speech.
- Support for multiple Arabic dialects and languages.
- Male and female voice options.
- Multiple voice personas.
- Customizable speaking speed and pitch.
- Expressive voice delivery styles and emotional intensity.
- Designed for social media content, advertisements, storytelling, and more.

### 🎬 AI Video Creator (Beta)

An experimental workflow for creating short promotional and commercial videos.

- Upload multiple images and video clips.
- Analyze visual assets and product details.
- Generate advertising concepts and creative direction.
- Create structured video editing plans.
- Configure narration using DoudouVoice Studio voices and dialects.
- Render video timelines using FFmpeg.
- Support for vertical, landscape, and square formats.
- Technical video validation and sampled-frame visual inspection.

### 🧠 Multi-Model Creative Workflow

The AI Video Creator uses a multi-model workflow:

- **Muse Spark 1.2 Contributor:** Asset analysis, creative direction, and editing plan generation.
- **Muse Spark 1.1 Reviewer:** Independent review of editing plans and post-render visual inspection.
- **FFmpeg:** Executes the validated video editing plan.
- **Modal Cloud:** Supports remote rendering where configured.

The editing review process can revise a plan through a bounded review loop before rendering.

### 📱 Designed for Content Creation

DoudouVoice is designed for creators, businesses, and marketers producing:

- TikTok and Instagram Reels.
- Product advertisements.
- E-commerce promotional videos.
- Arabic social media content.
- Voiceovers and promotional narration.

## 🛠️ Technology Stack

The project uses technologies including:

- **Frontend:** React, TypeScript, Vite, Tailwind CSS.
- **Backend:** Node.js, Express, TypeScript.
- **Database:** PostgreSQL / Supabase with Prisma.
- **AI:** Meta AI models and AI-powered speech generation.
- **Video Processing:** FFmpeg.
- **Cloud Rendering:** Modal, where configured.
- **Media Storage:** Cloudinary.

*The exact services and configuration depend on the deployment environment.*

## 🚀 Getting Started

### Prerequisites

Before running the project, make sure you have:

- Node.js and npm.
- Access to the project's required database.
- The necessary API credentials for configured AI and media services.
- FFmpeg installed if using local video rendering.

### Installation

Clone the repository:

```bash
git clone https://github.com/amrchdoudou/DOUDOUVOICE
```

Install dependencies:

```bash
npm install
```

Configure the environment variables using the project's environment configuration.

Start the development server:

```bash
npm run dev
```

Build the project:

```bash
npm run build
```

**Note:** Environment variable names, database setup, and deployment instructions should be taken from the actual project configuration. Never commit API keys or private credentials.

## 🔐 Environment Configuration

The application may require credentials for services such as:

- Database connection.
- Meta Model API.
- Text-to-speech provider.
- Cloud media storage.
- Modal rendering.

Keep credentials in environment variables and do not expose secrets in frontend code or public repositories.

## 🧪 Project Status

**DoudouVoice Studio:** Core voice-generation experience.

**AI Video Creator:** Beta / experimental development.

The AI Video Creator is under active improvement, particularly in narration synchronization, professional editing quality, visual consistency, and rendering reliability.

Features and provider availability may vary depending on the configured API services.

## 🗺️ Roadmap

- [ ] Improve Arabic dialect voice quality and expressiveness.
- [ ] Expand language and dialect coverage.
- [ ] Improve voice customization and delivery controls.
- [ ] Enhance professional video editing and transitions.
- [ ] Improve narration timing and audio synchronization.
- [ ] Strengthen post-render quality inspection.
- [ ] Improve cloud rendering reliability.
- [ ] Expand creative workflows for commercial content.

## 🤝 Contributing

Contributions, ideas, and feedback are welcome.

If you find a bug or have an idea for improving DoudouVoice, feel free to open an issue or submit a pull request.

Please avoid committing API keys, private credentials, generated media, or other sensitive files.

## 📄 License

A license has not yet been specified. All rights are reserved by the project owner unless a license is added to this repository.

---

**DoudouVoice — Giving every voice a way to express itself.**
