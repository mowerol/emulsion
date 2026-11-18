const points = [
  {
    title: 'Film recipes, full RAW editing',
    body: 'Apply a Fujifilm recipe to your RAW, then keep shaping exposure, colour and detail. Start with community recipes or build and save your own.',
  },
  {
    title: 'Proven algorithms',
    body: 'Colour, tone, masking and noise reduction ported from darktable, sharpening from RawTherapee. Years of refinement you can trust with your files.',
  },
  {
    title: 'A better experience',
    body: 'A clean interface over a Rust core with GPU processing. Sliders respond while you drag, and the tools are where you expect them.',
  },
  {
    title: 'Ready to replace Lightroom',
    body: 'Library and culling, local masks, retouching, noise reduction and local AI tools. The full workflow, without the subscription.',
  },
];

export default function WhyEmulsion() {
  return (
    <section aria-label="Why Emulsion" className="wrap sec">
      <p data-reveal className="eyebrow">Why Emulsion</p>
      <h2 data-reveal className="h2" style={{ maxWidth: '17ch' }}>
        Serious results, without a serious learning curve.
      </h2>
      <div className="why-grid">
        {points.map((p, i) => (
          <article key={p.title} data-reveal data-delay={i * 80} className="why-item">
            <h3 className="h3">{p.title}</h3>
            <p className="body">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
