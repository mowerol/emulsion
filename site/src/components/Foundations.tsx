import { site } from '../site.ts';

const sources = [
  {
    name: 'darktable',
    role: 'Colour, tone and local editing',
    items: ['Colour balance', 'Tone mapping', 'Highlights and shadows', 'Profiled noise reduction', 'Retouching', 'Masks'],
  },
  {
    name: 'RawTherapee',
    role: 'Detail and geometry',
    items: ['Richardson–Lucy capture sharpening', 'Automatic perspective correction'],
    note: 'Perspective correction also has roots in darktable.',
  },
  {
    name: 'LibRaw',
    role: 'Reading your camera’s files',
    items: ['RAW decoding'],
  },
];

export default function Foundations() {
  return (
    <section id="foundations" className="band">
      <div className="wrap band-inner">
        <p data-reveal className="eyebrow">Foundations</p>
        <h2 data-reveal className="h2 h2-xl" style={{ maxWidth: '15ch' }}>
          Built on serious photographic foundations.
        </h2>
        <p data-reveal className="lede" style={{ maxWidth: '46ch' }}>
          Emulsion combines image-processing algorithms adapted from darktable, RawTherapee, and Spektrafilm with RAW
          decoding through LibRaw, in a purpose-built GPU editing pipeline.
        </p>

        <div className="sources">
          {sources.map((s) => (
            <div key={s.name} data-reveal className="source">
              <div className="source-head">
                <h3 className="source-name">{s.name}</h3>
                <p className="source-role">{s.role}</p>
              </div>
              <div className="source-body">
                <ul className="source-list">
                  {s.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {s.note && <p className="source-note">{s.note}</p>}
              </div>
            </div>
          ))}
        </div>

        <div data-reveal className="source-foot">
          <a href={site.githubUrl} className="btn btn-outline btn-md">Read the source and NOTICE →</a>
          <span className="muted">Emulsion is licensed GPLv3+, the same spirit as the projects it builds on.</span>
        </div>
      </div>
    </section>
  );
}
