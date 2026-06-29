import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { fileContent, fileName, accessToken, mimeType } = req.body;

    if (!accessToken) {
      return res.status(401).json({ error: "Access token is required" });
    }

    if (!fileContent) {
      return res.status(400).json({ error: "File content is required" });
    }

    // Setup OAuth2 client
    const clientId = process.env.VITE_GOOGLE_CLIENT_ID || "780987725360-4k7qen9j0mh4epbo1u98tlf2eftik1n8.apps.googleusercontent.com";
    const oauth2Client = new google.auth.OAuth2(clientId);
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // 1. Ensure folder exists or create it
    let folderId = "";
    const folderRes = await drive.files.list({
      q: "name='Arsip Laporan Pemakaian Kantong' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id)",
      spaces: "drive",
    });

    const folderFiles = folderRes.data.files;
    if (folderFiles && folderFiles.length > 0) {
      folderId = folderFiles[0].id!;
    } else {
      const newFolder = await drive.files.create({
        requestBody: {
          name: "Arsip Laporan Pemakaian Kantong",
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      });
      folderId = newFolder.data.id!;
    }

    // 2. Convert base64 to Buffer
    const fileBuffer = Buffer.from(fileContent, "base64");
    const mime = mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    console.log(`[Drive Upload] fileName=${fileName}, bufferSize=${fileBuffer.length}`);

    // 3. Check if file already exists
    const existingFileRes = await drive.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: "files(id)",
      spaces: "drive",
    });

    let result;
    if (existingFileRes.data.files && existingFileRes.data.files.length > 0) {
      const fileId = existingFileRes.data.files[0].id!;
      result = await drive.files.update({
        fileId: fileId,
        media: {
          mimeType: mime,
          body: fileBuffer,
        },
        fields: "id, webViewLink",
      });
    } else {
      result = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
        },
        media: {
          mimeType: mime,
          body: fileBuffer,
        },
        fields: "id, webViewLink",
      });
    }

    console.log(`[Drive Upload] Success: fileId=${result.data.id}`);
    return res.status(200).json({
      success: true,
      fileId: result.data.id,
      link: result.data.webViewLink,
    });
  } catch (error: any) {
    console.error("Drive upload error:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
