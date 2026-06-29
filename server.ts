import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import { Readable } from "stream";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Helper to get OAuth2 client
function getOAuth2Client(accessToken: string) {
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID || "780987725360-4k7qen9j0mh4epbo1u98tlf2eftik1n8.apps.googleusercontent.com";
  const oauth2Client = new google.auth.OAuth2(clientId);
  oauth2Client.setCredentials({ access_token: accessToken });
  return oauth2Client;
}

// API Routes
app.post("/api/drive/upload", async (req, res) => {
  try {
    const { excelContent, fileName, accessToken } = req.body;

    console.log(`[Drive Upload] Received: fileName=${fileName}, base64Length=${excelContent?.length || 0}, hasToken=${!!accessToken}`);

    if (!accessToken) {
      return res.status(401).json({ error: "Access token is required" });
    }

    if (!excelContent || excelContent.length === 0) {
      return res.status(400).json({ error: "Excel content is empty" });
    }

    const auth = getOAuth2Client(accessToken);
    const drive = google.drive({ version: "v3", auth });

    // 1. Ensure folder "Arsip Laporan Pemakaian Kantong" exists or create it
    let folderId = "";
    const folderRes = await drive.files.list({
      q: "name='Arsip Laporan Pemakaian Kantong' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id)",
      spaces: "drive",
    });

    const files = folderRes.data.files;
    if (files && files.length > 0) {
      folderId = files[0].id!;
    } else {
      const folderMeta = {
        name: "Arsip Laporan Pemakaian Kantong",
        mimeType: "application/vnd.google-apps.folder",
      };
      const newFolder = await drive.files.create({
        requestBody: folderMeta,
        fields: "id",
      });
      folderId = newFolder.data.id!;
    }

    // 2. Convert base64 to Buffer and create Readable stream
    const fileBuffer = Buffer.from(excelContent, 'base64');
    const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const bufferStream = new Readable();
    bufferStream.push(fileBuffer);
    bufferStream.push(null);

    // 3. Check if file already exists in this folder
    const existingFileRes = await drive.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: "files(id)",
      spaces: "drive",
    });

    let file;
    if (existingFileRes.data.files && existingFileRes.data.files.length > 0) {
      // Update existing file
      const fileId = existingFileRes.data.files[0].id!;
      file = await drive.files.update({
        fileId: fileId,
        media: {
          mimeType: excelMime,
          body: bufferStream,
        },
        fields: "id, webViewLink",
      });
    } else {
      // Create new file
      const fileMetadata = {
        name: fileName,
        parents: [folderId],
      };
      const media = {
        mimeType: excelMime,
        body: bufferStream,
      };

      file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
      });
    }

    res.json({ success: true, fileId: file.data.id, link: file.data.webViewLink });
  } catch (error: any) {
    console.error("Drive upload error:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
