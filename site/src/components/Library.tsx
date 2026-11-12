const cards = [
  {
    title: 'Import and cull',
    body: 'Bring in folders where they already are. Rate, label, flag and reject in Grid or Loupe with Lightroom’s keys, and gather photos into collections and smart collections.',
  },
  {
    title: 'Works alongside Lightroom',
    body: 'Stars, colour labels, rejects, keywords and IPTC fields are read from and written to XMP sidecars, so Lightroom, Bridge and other apps see them too.',
  },
  {
    title: 'Copies, presets and sync',
    body: 'Keep several versions of a photo as virtual copies, save presets, and paste settings across a shoot. Every edit can be undone.',
  },
  {
    title: 'Export',
    body: 'JPEG, or 8- and 16-bit TIFF and PNG with an embedded sRGB profile, named by your own filename templates and saved as export presets.',
  },
];

export default function Library() {
  return (
    <section id="library" className="wrap sec">
      <div className="section-head">
        <div>
          <p data-reveal className="eyebrow">Library</p>
          <h2 data-reveal className="h2" style={{ maxWidth: '14ch' }}>
            From the card to the finished set.
          </h2>
        </div>
        <p data-reveal className="section-aside">
          Emulsion works on your photos where they are and never changes the originals.
        </p>
      </div>

      <div className="feature-grid">
        {cards.map((c, i) => (
          <article key={c.title} data-reveal data-delay={(i % 2) * 60} className="card feature feature-pad library-card">
            <h3 className="h3 h3-sm">{c.title}</h3>
            <p className="body body-sm">{c.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
