import Shot from './Shot.tsx';

export default function LocalAI() {
  return (
    <section id="features" className="wrap sec">
      <div className="section-head">
        <div>
          <p data-reveal className="eyebrow">Local AI</p>
          <h2 data-reveal className="h2" style={{ maxWidth: '14ch' }}>
            AI that never leaves your machine.
          </h2>
        </div>
        <p data-reveal className="section-aside">
          AI selects skies and subjects for masking and cleans up high-ISO noise. It all runs on your own hardware, with
          no uploads, credits or queues.
        </p>
      </div>

      <div className="feature-grid">
        <article data-reveal className="card feature feature-wide">
          <div className="feature-text">
            <h3 className="h3">Local masks</h3>
            <p className="body body-sm" style={{ maxWidth: '44ch' }}>
              Adjust a sky, a face or a doorway without touching the rest of the frame using AI mask selection tools.
            </p>
          </div>
          <div className="feature-media" style={{ aspectRatio: '16 / 9' }}>
            <Shot placeholder="Screenshot: a mask on the sky with its overlay visible" />
          </div>
        </article>

        <article data-reveal data-delay="80" className="card feature">
          <div className="feature-text">
            <h3 className="h3">Noise reduction and sharpening</h3>
            <p className="body body-sm">
              Clean up high-ISO files with AI-powered noise reduction and recover fine detail with capture sharpening.
            </p>
          </div>
          <div className="feature-media" style={{ aspectRatio: '1 / 1' }}>
            <Shot placeholder="100% crop: high-ISO file before and after" />
          </div>
        </article>

        <article data-reveal className="card feature feature-pad">
          <h3 className="h3 h3-sm">Retouching</h3>
          <p className="body body-sm">Remove dust spots, stray wires and the occasional photobomber.</p>
        </article>

        <article data-reveal data-delay="60" className="card feature feature-pad">
          <h3 className="h3 h3-sm">Local AI processing</h3>
          <p className="body body-sm">The smart tools run on your own hardware. No cloud, no credits, no waiting in a queue.</p>
        </article>
      </div>
    </section>
  );
}
