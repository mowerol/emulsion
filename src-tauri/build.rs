use std::path::Path;

/// Compile the vendored LibRaw and our shim into one static library. LibRaw is
/// always optimised: an unoptimised demosaic takes many seconds per photo.
fn build_libraw() {
    let root = Path::new("vendor/libraw");
    let mut sources: Vec<_> = walkdir::WalkDir::new(root.join("src"))
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        // The *_ph.cpp files are placeholders that LibRaw's own build leaves out.
        .filter(|p| p.extension().is_some_and(|x| x == "cpp") && !p.to_string_lossy().ends_with("_ph.cpp"))
        .collect();
    sources.sort();
    sources.push("native/raw_shim.cpp".into());

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .std("c++11")
        .include(root)
        .files(&sources)
        .opt_level(3)
        .debug(false)
        .warnings(false)
        .define("NO_LCMS", None);
    // Deflate-compressed DNGs need zlib, which macOS and Linux provide.
    if !cfg!(windows) {
        build.define("USE_ZLIB", None);
        println!("cargo:rustc-link-lib=z");
    }
    build.compile("libraw");

    println!("cargo:rerun-if-changed=native/raw_shim.cpp");
    println!("cargo:rerun-if-changed=vendor/libraw");
}

fn main() {
    build_libraw();
    tauri_build::build()
}
