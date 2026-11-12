#!/usr/bin/env swift
// Run from the repository root: swift tools/generate-icons.swift
import CoreGraphics
import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

let files = FileManager.default
let root = URL(fileURLWithPath: files.currentDirectoryPath)
let icons = root.appendingPathComponent("src-tauri/icons")
let source = icons.appendingPathComponent("source.png")
let artwork = root.appendingPathComponent("public/brand/app-icon.png")
let temporary = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try files.createDirectory(at: temporary, withIntermediateDirectories: true)
defer { try? files.removeItem(at: temporary) }

func generate(_ input: URL, into output: URL) throws {
    let process = Process()
    process.executableURL = root.appendingPathComponent("node_modules/.bin/tauri")
    process.arguments = ["icon", input.path, "--output", output.path, "--fit", "contain"]
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw NSError(domain: "IconGeneration", code: Int(process.terminationStatus))
    }
}

// Keep the supplied app icon intact, including its shading and transparent edges.
// Tauri contains its slightly rectangular canvas within square desktop outputs.
try Data(contentsOf: artwork).write(to: source, options: .atomic)

// Fit the visible tile, not the source canvas: supplied artwork can already
// include transparent margins and an asymmetric shadow. The 824 px tile matches
// the legacy ICNS layout used by macOS Notes and Calculator (1024 px canvas).
// Oli requested a slightly larger optical size for the app tile: 848 px,
// about 3% above that 824 px reference, with the visible tile still centered.
let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)!
let sourceContext = CGContext(
    data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
    bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
)!
sourceContext.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
let pixels = sourceContext.data!.assumingMemoryBound(to: UInt8.self)
var left = image.width, right = -1, topRow = image.height, bottomRow = -1
for y in 0..<image.height {
    for x in 0..<image.width where pixels[(y * image.width + x) * 4 + 3] >= 128 {
        left = min(left, x); right = max(right, x)
        topRow = min(topRow, y); bottomRow = max(bottomRow, y)
    }
}
guard right >= left, bottomRow >= topRow else { fatalError("Source icon has no visible artwork") }
// Bitmap rows start at the top; Core Graphics drawing coordinates start below.
let tile = CGRect(
    x: left, y: image.height - bottomRow - 1,
    width: right - left + 1, height: bottomRow - topRow + 1
)
let tileSize: CGFloat = 848
let scale = tileSize / max(tile.width, tile.height)
let frame = CGRect(
    x: 512 - tile.midX * scale, y: 512 - tile.midY * scale,
    width: CGFloat(image.width) * scale, height: CGFloat(image.height) * scale
)
let context = CGContext(
    data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
)!
context.clear(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.interpolationQuality = .high
context.draw(image, in: frame)
let padded = temporary.appendingPathComponent("macos-source.png")
let destination = CGImageDestinationCreateWithURL(padded as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else {
    fatalError("Could not write padded macOS icon")
}

let desktop = temporary.appendingPathComponent("desktop")
let macos = temporary.appendingPathComponent("macos")
try generate(source, into: desktop)
try generate(padded, into: macos)

// Keep the existing desktop asset set; mobile outputs are unused. The PNG is
// also used by Tauri's development app, so give it the same margin as the ICNS.
for target in try files.contentsOfDirectory(at: icons, includingPropertiesForKeys: nil) {
    let name = target.lastPathComponent
    if name == "source.png" { continue }
    let generated = (name == "icon.icns" || name == "icon.png" ? macos : desktop)
        .appendingPathComponent(name)
    let data = try Data(contentsOf: generated)
    try data.write(to: target, options: .atomic)
}

// The debug app keeps the brand tile, with a blue DEV badge large enough for the Dock.
// Keep it outside icons/: that directory is the generated release asset set above.
let badge = CGRect(x: 570, y: 82, width: 390, height: 210)
context.setFillColor(CGColor(srgbRed: 0.035, green: 0.23, blue: 0.62, alpha: 1))
context.addPath(CGPath(roundedRect: badge, cornerWidth: 48, cornerHeight: 48, transform: nil))
context.fillPath()
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
let label = NSAttributedString(string: "DEV", attributes: [
    .font: NSFont.systemFont(ofSize: 145, weight: .black),
    .foregroundColor: NSColor.white
])
let labelSize = label.size()
label.draw(at: CGPoint(x: badge.midX - labelSize.width / 2, y: badge.midY - labelSize.height / 2))
NSGraphicsContext.restoreGraphicsState()
let devIcon = root.appendingPathComponent("src-tauri/dev-icon.png")
let devDestination = CGImageDestinationCreateWithURL(devIcon as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(devDestination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(devDestination) else { fatalError("Could not write development icon") }
print("Desktop icons regenerated; the visible macOS tile is \(Int(tileSize)) px and centered on a 1024 px canvas.")
print("Development icon regenerated with a blue DEV badge.")
