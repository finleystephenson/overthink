// Cuts the product out of its studio backdrop using macOS's built-in subject lifting (Vision).
// Usage: swift tools/cutout.swift <in.jpg> <out.png>
// Why local: it is free, fast and repeatable, so new pictures never need a paid background-removal step.
import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let input = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else { fputs("usage: cutout in out\n", stderr); exit(1) }
let handler = VNImageRequestHandler(ciImage: input)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let result = request.results?.first else { fputs("no subject found\n", stderr); exit(2) }
let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: false)
let output = CIImage(cvPixelBuffer: buffer)
let rep = NSBitmapImageRep(ciImage: output)
guard let png = rep.representation(using: .png, properties: [:]) else { exit(3) }
try png.write(to: URL(fileURLWithPath: args[2]))
