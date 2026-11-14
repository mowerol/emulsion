import { useEffect, type ReactNode } from 'react';
import { site } from '../site.ts';

type Faq = { q: string; a: ReactNode; id?: string };

const faqs: Faq[] = [
  {
    q: 'Was it vibe coded?',
    a: 'AI coding tools did a lot of the typing, and they’re why one person can build an editor this size. The judgement isn’t generated, though. Emulsion is made by a product designer and software engineer with more than ten years of building software, who decides how it looks, how it works and which proven algorithms go into it. Those algorithms are ported from darktable and RawTherapee rather than invented, and each one is credited down to the upstream commit it came from in NOTICE.md. Every processing step has a tested reference, the GPU version is checked against it, and about 1,100 automated tests run before each release. The source is open for anyone to read.',
  },
  {
    q: 'Is it really free?',
    a: 'Yes. Emulsion is licensed under GPLv3 or later. There’s no paid tier, no trial and no account to create.',
  },
  {
    q: 'Which computers does it run on?',
    a: 'Macs with Apple silicon (M1 or later). There’s no version for Intel Macs, Windows or Linux for now.',
  },
  {
    id: 'install',
    q: 'Why does macOS block it the first time?',
    a: 'This beta isn’t signed by an Apple developer account, so macOS can’t check it. Drag Emulsion to Applications, open it, and click Done when macOS warns you. Then open System Settings › Privacy & Security, scroll to “Emulsion was blocked” and click Open Anyway. You only do this once: updates install from inside the app.',
  },
  {
    q: 'Where are my edits stored?',
    a: 'In Emulsion’s catalog, which it backs up for you; you choose how often and where in Settings. Your originals are never modified. If you’d like the edits to travel with your folders too, turn on “Also write edits beside photos” in Settings to keep a small file next to each photo.',
  },
  {
    q: 'Can I bring my photos over from Lightroom?',
    a: 'Yes. Import the folders your photos are already in. Stars, colour labels, rejects, keywords and IPTC fields come across through XMP sidecars, the same files Lightroom and Bridge use, and you can enable XMP sharing in Settings to write Emulsion’s metadata changes back to them. Lightroom’s develop settings don’t carry over. If Lightroom Classic keeps your metadata only in its catalog, select the photos there and choose Metadata › Save Metadata to File first.',
  },
  {
    q: 'Does the AI send my photos anywhere?',
    a: 'No. AI processing runs locally on your computer. Nothing is uploaded. The models are an optional download the first time you use an AI tool.',
  },
  {
    q: 'Does Emulsion collect any data?',
    a: 'No. There’s no account, analytics or tracking. It goes online only to check GitHub for updates and, when you ask, to download the optional AI models.',
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
    q: 'What’s missing in the beta?',
    a: 'RAW highlight recovery, export in colour spaces other than sRGB, and AVIF and HEIF files. RAWs from different cameras can also come out at slightly different brightness with the same look; that’s being worked on.',
  },
  {
    q: 'How is it related to darktable and RawTherapee?',
    a: 'Emulsion ports some of their algorithms into its own Rust core and wraps them in a different interface. Credit for that work belongs to those projects.',
  },
  {
    q: 'Found a bug?',
    a: (
      <>
        Please <a href={`${site.githubUrl}/issues`}>open an issue on GitHub</a> and attach the log file (Help › Show Log
        in Finder).
      </>
    ),
  },
];

/** Opens the answer a link points at (#install), on arrival and on later clicks. */
function useOpenTarget() {
  useEffect(() => {
    const open = (arrival: boolean) => {
      const el = location.hash ? document.getElementById(location.hash.slice(1)) : null;
      if (!(el instanceof HTMLDetailsElement)) return;
      el.open = true;
      // On arrival the browser looked for the target before React drew it; on a click it scrolls itself.
      if (arrival) el.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    open(true);
    const onHash = () => open(false);
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
}

export default function Faq() {
  useOpenTarget();
  return (
    <section id="faq" className="wrap sec">
      <div className="faq-grid">
        <div data-reveal>
          <p className="eyebrow">FAQ</p>
          <h2 className="h2">Fair questions.</h2>
        </div>
        <div data-reveal className="faq-list">
          {faqs.map((f) => (
            <details key={f.q} id={f.id} className="faq-item">
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
