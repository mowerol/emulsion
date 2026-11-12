import { site } from '../site.ts';
import Compare from './Compare.tsx';
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
            <Shot
              video={site.masksVideo.mp4 || undefined}
              src={site.masksVideo.poster}
              alt="Clicking three cows in a field with the AI object mask: each one fills with the yellow mask overlay."
              placeholder="Screen recording: AI object masks picked out with a click"
            />
          </div>
        </article>

        <article data-reveal data-delay="80" className="card feature">
          <div className="feature-text">
            <h3 className="h3">Noise reduction and sharpening</h3>
            <p className="body body-sm">
              Clean up high-ISO files with AI-powered noise reduction and recover fine detail with capture sharpening. Below: ISO 12800 on a Micro Four Thirds sensor.
            </p>
          </div>
          <div className="feature-media" style={{ aspectRatio: '1 / 1' }}>
            {site.noiseCompare.before && site.noiseCompare.after ? (
              <Compare
                before={site.noiseCompare.before}
                after={site.noiseCompare.after}
                alt="A close crop of a dog's face shot at ISO 12800 on a Micro Four Thirds camera: heavy colour noise on one side of the divider, clean fur on the other."
                beforeLabel="Original"
                afterLabel="Noise reduced"
              />
            ) : (
              <Shot placeholder="Before/after slider: a 100% crop of a high-ISO file, noise reduction off and on" />
            )}
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
