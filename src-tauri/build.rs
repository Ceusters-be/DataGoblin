fn main() {
    // Rebuild embedded window/executable icons when branding assets change.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
