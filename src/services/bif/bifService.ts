import { BifParser } from './BifFileParser';
import { FrameImageOffset } from './FrameImageOffset';
import { FrameImageSource } from './FrameImageSource';

export type BifDetails = {
  arrayBuffer: ArrayBuffer;
  frameImages: FrameImageOffset[];
};

export const getBifFrameImageSource = async (
  bifUrl: string,
): Promise<FrameImageSource | null> => {
  return (await getBifFile(bifUrl)).frameImageSource;
};

/**
 * Fetches a BIF once and returns both the sample's thumbnail source and the raw bytes, so Flipbook can read the
 * same file as a corpus without a second download.
 */
export const getBifFile = async (
  bifUrl: string,
): Promise<{ arrayBuffer: ArrayBuffer; frameImageSource: FrameImageSource | null; fetchMs: number }> => {
  try {
    const started = Date.now();
    const response = await fetch(bifUrl);

    if (!response.ok) {
      throw new Error(`HTTP error, status = ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fetchMs = Date.now() - started;

    const bifParser = new BifParser();
    const frameImageSource = bifParser.parse(arrayBuffer);

    return { arrayBuffer, frameImageSource, fetchMs };
  } catch (error) {
    throw new Error(`Error getting Bif File: ${error}`);
  }
};

export const getImageForVideoSecond = (
  second: number,
  baseUrl: string,
): string => {
  // Ensure second is not negative
  if (second < 0) {
    throw new Error('Second cannot be negative');
  }

  // Ensure baseUrl is provided
  if (!baseUrl) {
    throw new Error('Base URL is required');
  }

  // Remove trailing slash from baseUrl if it exists
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // Calculate which 10-second block we're in
  const blockNumber = Math.floor(second / 10) + 1;

  // Format the number with leading zeros (8 digits)
  const formattedNumber = blockNumber.toString().padStart(8, '0');

  // Return the complete URL
  return `${cleanBaseUrl}/${formattedNumber}.jpg`;
};
