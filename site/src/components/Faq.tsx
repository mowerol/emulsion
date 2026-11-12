const faqs = [
  {
    q: 'Was it vibe coded?',
    a: 'AI coding tools did a lot of the typing, and they’re why one person can build an editor this size. The judgement isn’t generated, though. Emulsion is made by a designer and developer with more than ten years of building software, who decides how it looks, how it works and which proven algorithms go into it. Every processing step is checked against a tested reference before it ships, and the source is open for anyone to read.',
  },
  {
    q: 'Is it really free?',
    a: 'Yes. Emulsion is licensed under GPLv3 or later. There’s no paid tier, no trial and no account to create.',
  },
  {
    q: 'Where are my edits stored?',
    a: 'In a small file next to each photo. Your originals are never modified, and if you move or back up a folder, the edits go with it.',
  },
  {
    q: 'Does the AI send my photos anywhere?',
    a: 'No. AI processing runs locally on your computer. Nothing is uploaded.',
  },
  {
    q: 'Will it open my camera’s RAW files?',
    a: 'Very likely. RAW decoding is handled by LibRaw, which supports most cameras on the market.',
  },
  {
    q: 'Can it replace Lightroom or Capture One?',
    a: 'It covers importing, culling, developing, masking, retouching and export. The best way to find out is to point it at a recent shoot and edit a few frames.',
  },
  {
    q: 'How is it related to darktable and RawTherapee?',
    a: 'Emulsion ports some of their algorithms into its own Rust core and wraps them in a different interface. Credit for that work belongs to those projects.',
  },
];

export default function Faq() {
  return (
    <section id="faq" className="wrap sec">
      <div className="faq-grid">
        <div data-reveal>
          <p className="eyebrow">FAQ</p>
          <h2 className="h2">Fair questions.</h2>
        </div>
        <div data-reveal className="faq-list">
          {faqs.map((f) => (
            <details key={f.q} className="faq-item">
              <summary>
                {f.q}
                <span className="faq-mark" aria-hidden="true">+</span>
              </summary>
              <p className="body">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
