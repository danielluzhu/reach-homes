# Listing photos

Any file here named `<listing-id>.jpg` (or .png / .webp / .avif) is used as that
listing's photo automatically. No code or JSON changes needed — the server
resolves it on the next request.

## Listing IDs

  4544-20th-ave-ne
  2120-ne-54th-st
  1714-ne-55th-pl
  4316-36th-ave-ne-l
  4735-22nd-ave-ne
  121-12th-ave-e-310

## Three ways to fill these in

1. From your own Zillow listings (fastest, gives the real photos):
   open the listing in a browser, right-click the photo, "Copy image address",
   then:

     bun scripts/add-photo.ts 1714-ne-55th-pl "https://photos.zillowstatic.com/..."

   Or put one "<listing-id> <url>" pair per line in a file and run:

     bun scripts/add-photo.ts --from photos.txt

2. Street View exteriors (automatic, needs a Google Maps API key):

     GOOGLE_MAPS_API_KEY=... bun scripts/fetch-photos.ts

3. Just copy image files in here named after the listing id.

## Note on scraping Zillow

Zillow listing *pages* are behind a PerimeterX bot challenge and return HTTP 403
to any script, so photos can't be pulled from a listing URL automatically.
Individual image URLs from photos.zillowstatic.com download fine, which is what
option 1 uses.
