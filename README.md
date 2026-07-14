# PrintEasy

PrintEasy is a lightweight, local web application designed to simplify scanning, arranging, and printing ID cards and documents. It interacts directly with Windows Image Acquisition (WIA) scanners and Windows printers.

## 🚀 Features

- **Direct Scanning:** Scans directly from your browser using your locally connected WIA scanner.
- **Smart ID Layouts:** Automatically arranges scanned IDs onto A4 or A5 pages.
  - **4 Copies (Two IDs):** Scan front and back once, and it auto-fills 4 zones (perfect for providing two copies of an ID).
  - **2 Copies (One ID):** Simple front and back layout.
- **B&W Thresholding:** Convert scans to crisp black and white with an adjustable threshold to save ink and improve readability.
- **Image Editing:** Easily rotate, crop, zoom, and adjust brightness/contrast directly in the browser.
- **Print Ready:** Sends the perfectly arranged, scaled canvas directly to your Windows printer without needing third-party software.

## 📦 Installation & Running

There are two ways to run PrintEasy:

### Option 1: Standalone Application (.exe)
If you have the compiled `PrintEasy.exe`, simply double-click it. 
It will launch a background server and automatically open the application in your default web browser at `http://localhost:5000`.

### Option 2: Run from Source (Python)
If you are running from the source code, you'll need Python installed on your Windows machine.

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the server:
   ```bash
   python server.py
   ```
3. Open your browser and navigate to `http://localhost:5000`.

## 🛠️ Built With

- **Backend:** Python, Flask, `pywin32` (for Windows scanner and printer APIs).
- **Frontend:** Vanilla JavaScript, HTML5 Canvas, CSS3.

## 📝 License
This project is open-source and available for personal or commercial use.
