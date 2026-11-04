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
    // Apple Clang can compile LibRaw's existing OpenMP loops, but needs LLVM's
    // runtime and headers. Link the runtime statically so installed apps do not
    // depend on Homebrew. Other platforms keep their existing build for now.
    println!("cargo:rerun-if-env-changed=LIBOMP_PREFIX");
    println!("cargo:rerun-if-env-changed=EMULSION_LIBRAW_SERIAL");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
        && std::env::var_os("EMULSION_LIBRAW_SERIAL").is_none()
    {
        let explicit = std::env::var_os("LIBOMP_PREFIX");
        let prefix = explicit.as_ref().map(std::path::PathBuf::from).unwrap_or_else(|| {
            if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
                "/opt/homebrew/opt/libomp".into()
            } else {
                "/usr/local/opt/libomp".into()
            }
        });
        let header = prefix.join("include/omp.h");
        let archive = prefix.join("lib/libomp.a");
        println!("cargo:rerun-if-changed={}", header.display());
        println!("cargo:rerun-if-changed={}", archive.display());
        if header.is_file() && archive.is_file() {
            build.flag("-Xpreprocessor").flag("-fopenmp")
                .include(prefix.join("include"))
                .define("LIBRAW_FORCE_OPENMP", None);
            // Emit the runtime after libraw so the static archive's references resolve.
            build.compile("libraw");
            println!("cargo:rustc-link-search=native={}", prefix.join("lib").display());
            println!("cargo:rustc-link-lib=static=omp");
        } else if explicit.is_some() {
            panic!("LIBOMP_PREFIX must contain include/omp.h and lib/libomp.a");
        } else {
            println!("cargo:warning=LibRaw is single-threaded; install libomp (brew install libomp) for parallel RAW decoding");
            build.compile("libraw");
        }
    } else {
        build.compile("libraw");
    }


    println!("cargo:rerun-if-changed=native/raw_shim.cpp");
    println!("cargo:rerun-if-changed=vendor/libraw");
}

fn main() {
    build_libraw();
    cc::Build::new().cpp(true).std("c++14")
        .include("vendor/rawtherapee-perspective")
        .file("native/perspective.cpp").opt_level(3).warnings(false)
        .compile("emulsion_perspective");
    println!("cargo:rerun-if-changed=native/perspective.cpp");
    println!("cargo:rerun-if-changed=vendor/rawtherapee-perspective");
    // darktable's DenseCRF, which refines AI object masks along the photo's edges.
    cc::Build::new().cpp(true).std("c++14")
        .include("vendor/darktable-densecrf")
        .file("native/densecrf_shim.cpp").opt_level(3).warnings(false)
        .compile("emulsion_densecrf");
    println!("cargo:rerun-if-changed=native/densecrf_shim.cpp");
    println!("cargo:rerun-if-changed=vendor/darktable-densecrf");
    tauri_build::build()
}
