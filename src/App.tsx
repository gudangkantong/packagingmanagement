import React, { useState, useEffect } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  getAuth,
  User
} from "firebase/auth";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "firebase/firestore";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  Trash2,
  Edit2,
  LogOut,
  Calendar as CalendarIcon,
  Download,
  ShieldCheck,
  Users,
  BarChart3,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  Cloud,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  LogIn,
  UserPlus,
  Lock,
  Unlock,
  Mail,
  UserCheck,
  X
} from "lucide-react";
import { auth, db, firebaseConfig } from "./firebase";
import { LaporanKantong, AllowedUser, LockedDate, ROLE_MAP, PABRIK_ROLE_MAP } from "./types";
import { getDateString, formatDateDisplay } from "./utils";
import { JENIS_KANTONG, JENIS_KANTONG_SHORT } from "./csvUtils";
import { downloadExcelReport, generateExcelReport } from "./excelUtils";
import logo from "./assets/logo.jpg";
enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
}

const VENDORS = ["GEMAH", "YANA", "HARDO", "IKSG", "KRR", "SAMI", "TRI USAHA"];
const PABRIK_LIST = ["Pabrik Baturaja 1 (PBR 1)", "Pabrik Baturaja 2 (PBR 2)", "Pabrik Palembang (PPG)", "Pabrik Panjang (PPJ)"];
const SHIFT_INFO = [
  { id: 1, label: "Shift 1", time: "00:00 – 08:00", color: "text-blue-600 bg-blue-50 border-blue-200" },
  { id: 2, label: "Shift 2", time: "08:00 – 16:00", color: "text-purple-600 bg-purple-50 border-purple-200" },
  { id: 3, label: "Shift 3", time: "16:00 – 24:00", color: "text-amber-600 bg-amber-50 border-amber-200" }
];

export default function App() {
  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null); // null means checking
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  // Form inputs for Auth
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // App data state (real-time synchronized from Firestore)
  const [reports, setReports] = useState<LaporanKantong[]>([]);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUser[]>([]);
  const [lockedDates, setLockedDates] = useState<Record<string, LockedDate>>({});
  const [dataLoading, setDataLoading] = useState<boolean>(true);

  // Role-based check (dari Firestore allowed_users collection)
  const currentUserData = allowedUsers.find(u => u.email === currentUser?.email?.toLowerCase());
  const userRole = currentUserData?.role || (currentUser?.isAnonymous ? 'guest' : null);
  const userPabrikRole = currentUserData?.pabrikRole || null;
  const isMasterAdmin = userRole === 'super_admin';
  const isAdmin = userRole === 'super_admin' || userRole === 'admin';
  const isGuest = userRole === 'guest' || currentUser?.isAnonymous === true || (currentUser?.email?.startsWith('guest_') ?? false);

  // Active page state
  const [activeTab, setActiveTab] = useState<"dash" | "input" | "users">("dash");

  // Selected date state
  const [selectedDate, setSelectedDate] = useState<string>(getDateString(new Date()));
  const [showLockedAlert, setShowLockedAlert] = useState(false);
  const [driveToken, setDriveToken] = useState<string | null>(localStorage.getItem("smbr_drive_token"));
  const [isDriveUploading, setIsDriveUploading] = useState(false);

  useEffect(() => {
    setSelectedDate(getDateString(new Date()));
  }, []);

  // Derived state
  const isSelectedDateLocked = !!lockedDates[selectedDate]?.locked;

  // Auto-hide locked alert after 8 seconds
  useEffect(() => {
    if (isSelectedDateLocked) {
      setShowLockedAlert(true);
      const timer = setTimeout(() => {
        setShowLockedAlert(false);
      }, 8000);
      return () => clearTimeout(timer);
    } else {
      setShowLockedAlert(false);
    }
  }, [selectedDate, isSelectedDateLocked]);

  // Toast notification state
  const [toasts, setToasts] = useState<{ id: string; text: string; type: "ok" | "er" | "inf" }[]>([]);
  const [logoErrorLogin, setLogoErrorLogin] = useState(false);
  const [logoErrorHeader, setLogoErrorHeader] = useState(false);

  // Modal form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedBagTypes, setExpandedBagTypes] = useState<Record<string, boolean>>({});
  const [expandedShifts, setExpandedShifts] = useState<Record<string, boolean>>({});
  const [formVendor, setFormVendor] = useState(VENDORS[0]);
  const [formJenis, setFormJenis] = useState(JENIS_KANTONG[0]);
  const [formPabrik, setFormPabrik] = useState(PABRIK_LIST[0]);
  const [formShift, setFormShift] = useState(1);
  const [formTanggal, setFormTanggal] = useState(getDateString(new Date()));
  const [formUtuh, setFormUtuh] = useState("");
  const [formPecah, setFormPecah] = useState("");
  const [formSortir, setFormSortir] = useState("");

  // User management state
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [newAllowedPassword, setNewAllowedPassword] = useState("");
  const [newPabrikRole, setNewPabrikRole] = useState<"" | "pbr1" | "pbr2" | "ppg" | "ppj" | "all">("");
  const newUserRole = "admin" as const;
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [userActionError, setUserActionError] = useState("");
  const [editingUserBadge, setEditingUserBadge] = useState<string | null>(null);
  const [editingBadgeValue, setEditingBadgeValue] = useState<"" | "pbr1" | "pbr2" | "ppg" | "ppj" | "all">("");

  // Master data lists (synced from Firestore)
  const [dynamicVendors, setDynamicVendors] = useState<string[]>([]);
  const [dynamicJenisKantong, setDynamicJenisKantong] = useState<string[]>([]);
  const [dynamicPabrikList, setDynamicPabrikList] = useState<string[]>([]);
  const [newVendor, setNewVendor] = useState("");
  const [newJenisKantong, setNewJenisKantong] = useState("");
  const [newPabrik, setNewPabrik] = useState("");
  const [editingMasterData, setEditingMasterData] = useState<{
    collection: string;
    docId: string;
    originalName: string;
    editedName: string;
  } | null>(null);

  // Effective lists (dynamic from Firestore, fallback to hardcoded)
  const effectiveVendors = dynamicVendors.length > 0 ? dynamicVendors : VENDORS;
  const effectiveJenisKantong = dynamicJenisKantong.length > 0 ? dynamicJenisKantong : JENIS_KANTONG;
  const effectivePabrikList = dynamicPabrikList.length > 0 ? dynamicPabrikList : PABRIK_LIST;
  const userAllowedPabrik = !userPabrikRole || userPabrikRole === 'all'
    ? effectivePabrikList
    : effectivePabrikList.filter(p => {
        const m: Record<string, string> = { pbr1: 'PBR 1', pbr2: 'PBR 2', ppg: 'PPG', ppj: 'PPJ' };
        const kw = m[userPabrikRole];
        return kw ? p.includes(kw) : true;
      });

  // Toast triggering helper
  const triggerToast = (text: string, type: "ok" | "er" | "inf" = "inf") => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Listen to Auth state
  useEffect(() => {
    let unsubSelf: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Clear previous snapshot listener if it exists
      if (unsubSelf) {
        unsubSelf();
        unsubSelf = null;
      }

      setAuthLoading(true);
      setCurrentUser(user);
      if (user) {
        if (user.isAnonymous || user.email?.toLowerCase().includes("guest")) {
          setIsAllowed(true);
          setAuthLoading(false);
          return;
        }
        const userEmail = user.email ? user.email.toLowerCase() : "";

        // Admin bootstrapping check: automatically authorize managementpackaging@gmail.com
        if (userEmail === "managementpackaging@gmail.com") {
          let bootstrapSuccess = false;
          try {
            const userDocRef = doc(db, "allowed_users", userEmail);
            const docSnap = await getDoc(userDocRef);
            // Always ensure admin document exists with correct fields
            if (!docSnap.exists() || !docSnap.data()?.allowed || docSnap.data()?.role !== 'super_admin') {
              await setDoc(userDocRef, {
                email: userEmail,
                allowed: true,
                role: 'super_admin',
                addedAt: docSnap.exists() ? (docSnap.data()?.addedAt || new Date().toISOString()) : new Date().toISOString()
              }, { merge: true });
              if (!docSnap.exists() || !docSnap.data()?.allowed) {
                triggerToast("Admin account bootstrapped successfully", "ok");
              } else {
                triggerToast("Admin utama role restored", "ok");
              }
            }
            bootstrapSuccess = true;
          } catch (e) {
            console.error("Autobootstrap failed:", e);
            handleFirestoreError(e, OperationType.WRITE, `allowed_users/${userEmail}`);
            // If bootstrap failed, try once more with a fresh write
            try {
              const userDocRef = doc(db, "allowed_users", userEmail);
              await setDoc(userDocRef, {
                email: userEmail,
                allowed: true,
                role: 'super_admin',
                addedAt: new Date().toISOString()
              }, { merge: true });
              bootstrapSuccess = true;
            } catch (retryErr) {
              console.error("Bootstrap retry also failed:", retryErr);
              handleFirestoreError(retryErr, OperationType.WRITE, `allowed_users/${userEmail}`);
            }
          }
          // Only set isAllowed after bootstrap completes
          setIsAllowed(bootstrapSuccess);
          if (!bootstrapSuccess) {
            triggerToast("Gagal menginisialisasi admin. Silakan refresh halaman.", "er");
          }
        }

        // Real-time listener for the user's own authorization status
        const selfDocRef = doc(db, "allowed_users", userEmail);
        unsubSelf = onSnapshot(selfDocRef, (snap) => {
          if (userEmail === "managementpackaging@gmail.com") {
            setIsAllowed(true);
          } else if (snap.exists() && snap.data()?.allowed === true) {
            setIsAllowed(true);
          } else {
            setIsAllowed(false);
          }
          setAuthLoading(false);
        }, (err) => {
          console.warn("Allowance snapshot status check ended or failed:", err.message);
          if (userEmail === "managementpackaging@gmail.com") {
            setIsAllowed(true);
          } else {
            setIsAllowed(false);
          }
          setAuthLoading(false);
        });
      } else {
        setIsAllowed(null);
        setAuthLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubSelf) {
        unsubSelf();
      }
    };
  }, []);

  // Listen to Firestore reports collection when authorized
  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setReports([]);
      return;
    }

    setDataLoading(true);
    const reportsQuery = query(collection(db, "laporan_kantong"), orderBy("updatedAt", "desc"));
    const unsubReports = onSnapshot(reportsQuery, (querySnapshot) => {
      const items: LaporanKantong[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          vendor: data.vendor || "",
          nama: data.nama || "",
          pabrik: data.pabrik || "",
          shift: Number(data.shift) || 1,
          tanggal: data.tanggal || "",
          utuh: Number(data.utuh) || 0,
          pecah: Number(data.pecah) || 0,
          sortir: Number(data.sortir) || 0,
          total: Number(data.total) || 0,
          createdBy: data.createdBy || "",
          updatedAt: data.updatedAt || ""
        });
      });
      setReports(items);
      setDataLoading(false);
    }, (err) => {
      console.error("Failed to sync reports:", err);
      triggerToast("Gagal menyinkronkan data real-time", "er");
      setDataLoading(false);
      handleFirestoreError(err, OperationType.GET, "laporan_kantong");
    });

    return () => unsubReports();
  }, [currentUser, isAllowed]);

  // Listen to allowed_users collection when authorized
  useEffect(() => {
    if (!currentUser || isAllowed !== true || currentUser.isAnonymous) {
      setAllowedUsers([]);
      return;
    }

    const usersQuery = collection(db, "allowed_users");
    const unsubUsers = onSnapshot(usersQuery, (querySnapshot) => {
      const items: AllowedUser[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          email: data.email || docSnap.id,
          allowed: data.allowed === true,
          role: data.role || "admin",
          pabrikRole: data.pabrikRole || null,
          addedAt: data.addedAt || ""
        });
      });
      setAllowedUsers(items);
    }, (err) => {
      console.error("Failed to sync allowed users:", err);
      handleFirestoreError(err, OperationType.GET, "allowed_users");
    });

    return () => unsubUsers();
  }, [currentUser, isAllowed]);

  // Listen to locked_dates collection when authorized
  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setLockedDates({});
      return;
    }

    const lockedQuery = collection(db, "locked_dates");
    const unsubLocked = onSnapshot(lockedQuery, (querySnapshot) => {
      const datesMap: Record<string, LockedDate> = {};
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.locked) {
          datesMap[docSnap.id] = {
            locked: true,
            lockedBy: data.lockedBy || "",
            lockedAt: data.lockedAt || ""
          };
        }
      });
      setLockedDates(datesMap);
    }, (err) => {
      console.error("Failed to sync locked dates:", err);
      handleFirestoreError(err, OperationType.GET, "locked_dates");
    });

    return () => unsubLocked();
  }, [currentUser, isAllowed]);

  // Listen to master data collections (vendors, jenis_kantong, pabrik)
  useEffect(() => {
    if (!currentUser || isAllowed !== true) {
      setDynamicVendors([]);
      setDynamicJenisKantong([]);
      setDynamicPabrikList([]);
      return;
    }

    const bootstrapCollection = async (
      collectionName: string,
      defaults: string[]
    ) => {
      try {
        const { getDocs } = await import("firebase/firestore");
        const snap = await getDocs(collection(db, collectionName));
        if (snap.empty) {
          // Auto-populate with hardcoded defaults
          for (const item of defaults) {
            const docId = item.toLowerCase().replace(/[^a-z0-9]/g, '_');
            await setDoc(doc(db, collectionName, docId), {
              name: item,
              addedAt: new Date().toISOString(),
              addedBy: "system_bootstrap"
            });
          }
        }
      } catch (e) {
        console.error(`Bootstrap ${collectionName} failed:`, e);
      }
    };

    bootstrapCollection("vendors", VENDORS);
    bootstrapCollection("jenis_kantong", JENIS_KANTONG);
    bootstrapCollection("pabrik_list", PABRIK_LIST);

    const unsubVendors = onSnapshot(collection(db, "vendors"), (snap) => {
      const items: string[] = [];
      snap.forEach((d) => {
        const name = d.data().name;
        if (name) items.push(name);
      });
      setDynamicVendors(items);
    }, (err) => {
      console.error("Failed to sync vendors:", err);
    });

    const unsubJenis = onSnapshot(collection(db, "jenis_kantong"), (snap) => {
      const items: string[] = [];
      snap.forEach((d) => {
        const name = d.data().name;
        if (name) items.push(name);
      });
      setDynamicJenisKantong(items);
    }, (err) => {
      console.error("Failed to sync jenis_kantong:", err);
    });

    const unsubPabrik = onSnapshot(collection(db, "pabrik_list"), (snap) => {
      const items: string[] = [];
      snap.forEach((d) => {
        const name = d.data().name;
        if (name) items.push(name);
      });
      setDynamicPabrikList(items);
    }, (err) => {
      console.error("Failed to sync pabrik_list:", err);
    });

    return () => {
      unsubVendors();
      unsubJenis();
      unsubPabrik();
    };
  }, [currentUser, isAllowed]);

  // Prevent unauthorized access to "users" tab
  useEffect(() => {
    if (activeTab === "users" && !isMasterAdmin) {
      setActiveTab("dash");
    }
    if (activeTab === "input" && isGuest) {
      setActiveTab("dash");
    }
  }, [activeTab, currentUser]);

  // Handle Guest Login
  const handleGuestLogin = async () => {
    setAuthError("");
    setAuthLoading(true);
    
    // Get or create a sticky guest ID for this device
    let guestId = localStorage.getItem("smbr_guest_id");
    if (!guestId) {
      guestId = Math.random().toString(36).substring(2, 12);
      localStorage.setItem("smbr_guest_id", guestId);
    }
    
    const guestEmail = `guest_${guestId}@laporan.com`;
    const guestPass = `pass_${guestId}`;

    try {
      // Try to sign in with the persistent guest account
      await signInWithEmailAndPassword(auth, guestEmail, guestPass);
      triggerToast("Berhasil masuk sebagai Tamu!", "ok");
    } catch (err: any) {
      // If user doesn't exist, create it
      if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
        try {
          await createUserWithEmailAndPassword(auth, guestEmail, guestPass);
          triggerToast("Berhasil masuk sebagai Tamu!", "ok");
        } catch (createErr: any) {
          console.error("Failed to create sticky guest account:", createErr);
          // Last resort: standard anonymous sign-in
          try {
            await signInAnonymously(auth);
            triggerToast("Berhasil masuk sebagai Tamu (Sesi Baru)!", "ok");
          } catch (anonErr) {
            setAuthError("Gagal masuk sebagai Tamu. Silakan hubungi Admin.");
          }
        }
      } else {
        console.error("Guest login error:", err);
        setAuthError("Gagal masuk sebagai Tamu: " + (err.message || String(err)));
      }
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle Authentication
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    if (!email || !password) {
      setAuthError("Email dan password wajib diisi");
      setAuthLoading(false);
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      triggerToast("Berhasil masuk!", "ok");
    } catch (err: any) {
      console.error("Auth Error:", err);
      let errorMsg = "Terjadi kesalahan. Silakan coba lagi.";
      if (err.code === "auth/invalid-email") {
        errorMsg = "Format email tidak valid.";
      } else if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        errorMsg = "Email atau password salah.";
      } else if (err.code === "auth/too-many-requests") {
        errorMsg = "Terlalu banyak percobaan. Coba lagi nanti.";
      } else if (err.code === "auth/operation-not-allowed") {
        errorMsg = "Metode masuk Email/Password belum diaktifkan di Firebase Console Anda. Silakan aktifkan terlebih dahulu.";
      }
      setAuthError(errorMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setDriveToken(null);
      localStorage.removeItem("smbr_drive_token");
      triggerToast("Berhasil keluar", "inf");
    } catch (err) {
      console.error("Logout Error:", err);
    }
  };

  // Manage Authorized Users list
  const handleAddAllowedUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserActionError("");
    const targetEmail = newAllowedEmail.trim().toLowerCase();
    const targetPassword = newAllowedPassword.trim();

    if (!targetEmail) {
      setUserActionError("Masukkan email yang valid");
      return;
    }

    setIsCreatingAccount(true);

    let secondaryApp;
    try {
      if (targetPassword) {
        if (targetPassword.length < 6) {
          throw new Error("Password minimal harus 6 karakter.");
        }
        
        // Create secondary app to register user in Auth without signing out current admin
        const secondaryAppName = `Secondary-${Date.now()}`;
        secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
        const secondaryAuth = getAuth(secondaryApp);
        try {
          await createUserWithEmailAndPassword(secondaryAuth, targetEmail, targetPassword);
        } catch (authErr: any) {
          if (authErr.code !== "auth/email-already-in-use") {
            throw authErr;
          }
          // Already exists, just proceed to add to allowed_users
        }
      }

      const userDocRef = doc(db, "allowed_users", targetEmail);
      const userData: any = {
        email: targetEmail,
        allowed: true,
        role: "admin",
        addedAt: new Date().toISOString()
      };
      if (newPabrikRole) userData.pabrikRole = newPabrikRole;
      await setDoc(userDocRef, userData);

      setNewAllowedEmail("");
      setNewAllowedPassword("");
      setNewPabrikRole("");
      
      if (targetPassword) {
        triggerToast(`Akun berhasil dibuat & izin akses diberikan untuk ${targetEmail}`, "ok");
      } else {
        triggerToast(`Izin akses diberikan untuk ${targetEmail}`, "ok");
      }
    } catch (err: any) {
      console.error("Add user / register failed:", err);
      let errorMsg = "Gagal memproses pengguna baru.";
      if (err.code === "auth/email-already-in-use" || err.message?.includes("email-already-in-use")) {
        errorMsg = "Email ini sudah terdaftar di Firebase Authentication.";
      } else if (err.code === "auth/invalid-email" || err.message?.includes("invalid-email")) {
        errorMsg = "Format email tidak valid.";
      } else if (err.code === "auth/weak-password" || err.message?.includes("weak-password")) {
        errorMsg = "Password minimal harus 6 karakter.";
      } else if (err instanceof Error) {
        errorMsg = err.message;
      }
      setUserActionError(errorMsg);
      triggerToast("Gagal memproses pengguna baru", "er");
    } finally {
      setIsCreatingAccount(false);
      if (secondaryApp) {
        try {
          await deleteApp(secondaryApp);
        } catch (e) {
          console.error("Failed to delete secondary app:", e);
        }
      }
    }
  };

  const handleRemoveAllowedUser = async (targetEmail: string) => {
    if (targetEmail.toLowerCase() === "managementpackaging@gmail.com") {
      triggerToast("Admin utama tidak dapat dihapus!", "er");
      return;
    }
    
    setConfirmModal({
      isOpen: true,
      title: "Hapus Akses Pengguna",
      message: `Apakah Anda yakin ingin mencabut izin akses untuk ${targetEmail}?`,
      onConfirm: async () => {
        try {
          const userDocRef = doc(db, "allowed_users", targetEmail.toLowerCase());
          await deleteDoc(userDocRef);
          triggerToast(`Berhasil menghapus izin untuk ${targetEmail}`, "ok");
        } catch (err) {
          console.error("Remove user failed:", err);
          triggerToast("Gagal menghapus izin akses", "er");
          handleFirestoreError(err, OperationType.DELETE, `allowed_users/${targetEmail}`);
        }
      }
    });
  };

  const handleSaveUserBadge = async (targetEmail: string) => {
    try {
      const userDocRef = doc(db, "allowed_users", targetEmail.toLowerCase());
      if (editingBadgeValue) {
        await setDoc(userDocRef, { pabrikRole: editingBadgeValue }, { merge: true });
      } else {
        // Use setDoc with merge instead of updateDoc to avoid failure if doc doesn't exist
        await setDoc(userDocRef, { pabrikRole: null }, { merge: true });
      }
      setEditingUserBadge(null);
      triggerToast(`Badge pabrik untuk ${targetEmail} berhasil diperbarui`, "ok");
    } catch (err) {
      console.error("Update badge failed:", err);
      triggerToast("Gagal memperbarui badge", "er");
    }
  };

  // Master data management handlers
  const handleAddMasterData = async (
    collectionName: string,
    value: string,
    setValue: (v: string) => void,
    label: string
  ) => {
    const trimmed = value.trim();
    if (!trimmed) {
      triggerToast(`Nama ${label} tidak boleh kosong`, "er");
      return;
    }
    try {
      const docId = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '_');
      await setDoc(doc(db, collectionName, docId), {
        name: trimmed,
        addedAt: new Date().toISOString(),
        addedBy: currentUser?.email || "unknown"
      });
      setValue("");
      triggerToast(`${label} "${trimmed}" berhasil ditambahkan`, "ok");
    } catch (err: any) {
      console.error(`Add ${label} failed:`, err);
      const errMsg = err?.code === 'permission-denied'
        ? `Akses ditolak. Pastikan Anda memiliki izin Admin Utama.`
        : `Gagal menambahkan ${label}: ${err?.message || 'Unknown error'}`;
      triggerToast(errMsg, "er");
    }
  };

  const handleDeleteMasterData = async (
    collectionName: string,
    docId: string,
    label: string,
    displayName: string
  ) => {
    setConfirmModal({
      isOpen: true,
      title: `Hapus ${label}`,
      message: `Apakah Anda yakin ingin menghapus "${displayName}" dari daftar ${label}?`,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, collectionName, docId));
          triggerToast(`${label} "${displayName}" berhasil dihapus`, "ok");
        } catch (err) {
          console.error(`Delete ${label} failed:`, err);
          triggerToast(`Gagal menghapus ${label}`, "er");
        }
      }
    });
  };

  const handleEditMasterData = (
    collection: string,
    docId: string,
    currentName: string
  ) => {
    setEditingMasterData({
      collection,
      docId,
      originalName: currentName,
      editedName: currentName
    });
  };

  const handleSaveEditMasterData = async () => {
    if (!editingMasterData) return;
    const { collection: coll, docId, originalName, editedName } = editingMasterData;
    const trimmed = editedName.trim();
    if (!trimmed) {
      triggerToast("Nama tidak boleh kosong", "er");
      return;
    }
    if (trimmed === originalName) {
      setEditingMasterData(null);
      return;
    }
    try {
      await setDoc(doc(db, coll, docId), {
        name: trimmed,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser?.email || "unknown"
      }, { merge: true });
      setEditingMasterData(null);
      triggerToast(`Berhasil mengubah nama menjadi "${trimmed}"`, "ok");
    } catch (err: any) {
      console.error("Edit master data failed:", err);
      const errMsg = err?.code === 'permission-denied'
        ? "Akses ditolak. Pastikan Anda memiliki izin Admin Utama."
        : `Gagal mengubah data: ${err?.message || 'Unknown error'}`;
      triggerToast(errMsg, "er");
    }
  };

  const handleCancelEditMasterData = () => {
    setEditingMasterData(null);
  };

  // Manage Report Records
  const handleOpenAddForm = () => {
    setEditingId(null);
    setFormVendor(effectiveVendors[0]);
    setFormJenis(effectiveJenisKantong[0]);
    const defaultPabrik = userAllowedPabrik.length > 0 ? userAllowedPabrik[0] : effectivePabrikList[0];
    setFormPabrik(defaultPabrik);
    const currentHour = new Date().getHours();
    setFormShift(currentHour < 8 ? 1 : currentHour < 16 ? 2 : 3);
    setFormTanggal(getDateString(new Date()));
    setFormUtuh("");
    setFormPecah("");
    setFormSortir("");
    setIsModalOpen(true);
  };

  const handleOpenEditForm = (item: LaporanKantong) => {
    const isDateLocked = !!lockedDates[item.tanggal]?.locked;
    if (isDateLocked && !isMasterAdmin) {
      triggerToast(`Laporan pada tanggal ${formatDateDisplay(item.tanggal)} berstatus Verified (Terkunci) oleh Admin Utama.`, "er");
      return;
    }

    if (!isMasterAdmin && userPabrikRole && userAllowedPabrik.length > 0) {
      if (!userAllowedPabrik.some(p => p === item.pabrik)) {
        triggerToast(`Anda tidak memiliki akses untuk mengedit data pabrik ${item.pabrik}.`, "er");
        return;
      }
    }

    setEditingId(item.id);
    setFormVendor(item.vendor);
    setFormJenis(item.nama);
    setFormPabrik(item.pabrik);
    setFormShift(item.shift);
    setFormTanggal(item.tanggal);
    setFormUtuh(item.utuh.toString());
    setFormPecah(item.pecah.toString());
    setFormSortir(item.sortir.toString());
    setIsModalOpen(true);
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if the target date is locked
    const isTargetDateLocked = !!lockedDates[formTanggal]?.locked;
    if (isTargetDateLocked && !isMasterAdmin) {
      triggerToast(`Data pada tanggal ${formTanggal} berstatus Verified (Terkunci) oleh Admin Utama.`, "er");
      return;
    }

    // Check if original date (if editing) was locked
    if (editingId) {
      const existingEntry = reports.find(r => r.id === editingId);
      if (existingEntry) {
        const isOrigDateLocked = !!lockedDates[existingEntry.tanggal]?.locked;
        if (isOrigDateLocked && !isMasterAdmin) {
          triggerToast(`Data pada tanggal asli (${formatDateDisplay(existingEntry.tanggal)}) berstatus Verified.`, "er");
          return;
        }
      }
    }

    const utuhNum = Number(formUtuh) || 0;
    const pecahNum = Number(formPecah) || 0;
    const sortirNum = Number(formSortir) || 0;
    const totalNum = utuhNum + pecahNum + sortirNum;

    if (utuhNum === 0 && pecahNum === 0 && sortirNum === 0) {
      triggerToast("Minimal isi satu jumlah (Utuh, Pecah, atau Sortir)", "er");
      return;
    }

    if (!isMasterAdmin && userPabrikRole && userAllowedPabrik.length > 0) {
      if (!userAllowedPabrik.some(p => p === formPabrik)) {
        triggerToast(`Anda tidak memiliki akses untuk menulis data pabrik ${formPabrik}.`, "er");
        return;
      }
    }

    const docId = editingId || `report_${Date.now()}`;
    const entryData = {
      id: docId,
      vendor: formVendor,
      nama: formJenis,
      pabrik: formPabrik,
      shift: Number(formShift),
      tanggal: formTanggal,
      utuh: utuhNum,
      pecah: pecahNum,
      sortir: sortirNum,
      total: totalNum,
      createdBy: currentUser?.email || "unknown",
      updatedAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, "laporan_kantong", docId), entryData, { merge: true });
      setIsModalOpen(false);
      triggerToast(editingId ? "Laporan diperbarui" : "Laporan ditambahkan", "ok");
    } catch (err) {
      console.error("Save entry failed:", err);
      triggerToast("Gagal menyimpan laporan ke database", "er");
      handleFirestoreError(err, OperationType.WRITE, `laporan_kantong/${docId}`);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    const item = reports.find(r => r.id === id);
    if (item) {
      const isDateLocked = !!lockedDates[item.tanggal]?.locked;
      if (isDateLocked && !isMasterAdmin) {
        triggerToast(`Laporan pada tanggal ${formatDateDisplay(item.tanggal)} berstatus Verified (Terkunci) oleh Admin Utama. Tidak dapat dihapus.`, "er");
        return;
      }
    }

    setConfirmModal({
      isOpen: true,
      title: "Hapus Baris Laporan",
      message: "Apakah Anda yakin ingin menghapus baris laporan ini?",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "laporan_kantong", id));
          triggerToast("Laporan berhasil dihapus", "ok");
        } catch (err) {
          console.error("Delete entry failed:", err);
          triggerToast("Gagal menghapus laporan", "er");
          handleFirestoreError(err, OperationType.DELETE, `laporan_kantong/${id}`);
        }
      }
    });
  };

  // Function to initialize Google Drive Login
  const handleLoginDrive = () => {
    if (!(window as any).google) {
      triggerToast("Gagal memuat layanan Google. Coba refresh halaman.", "er");
      return;
    }

    const clientId = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID || "780987725360-4k7qen9j0mh4epbo1u98tlf2eftik1n8.apps.googleusercontent.com";

    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response: any) => {
        if (response.access_token) {
          setDriveToken(response.access_token);
          localStorage.setItem("smbr_drive_token", response.access_token);
          triggerToast("Berhasil terhubung ke Google Drive!", "ok");
        }
      },
    });
    client.requestAccessToken();
  };

  const uploadToDrive = async (token: string, excelBlob: Blob, date: string) => {
    setIsDriveUploading(true);
    try {
      const fileName = `Laporan_Kantong_${date}.xlsx`;

      // 1. Find or create folder
      const folderName = "Arsip Laporan Pemakaian Kantong";
      const folderSearch = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const folderData = await folderSearch.json();

      let folderId = "";
      if (folderData.files && folderData.files.length > 0) {
        folderId = folderData.files[0].id;
      } else {
        // Create folder
        const createFolder = await fetch("https://www.googleapis.com/drive/v3/files", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
          }),
        });
        const folderResult = await createFolder.json();
        folderId = folderResult.id;
      }

      // 2. Check if file exists
      const fileSearch = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and '${folderId}' in parents and trashed=false&fields=files(id)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const fileData = await fileSearch.json();

      // 3. Upload file (create or update)
      const metadata = {
        name: fileName,
        parents: fileData.files?.length > 0 ? undefined : [folderId],
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };

      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", excelBlob);

      let uploadRes;
      if (fileData.files && fileData.files.length > 0) {
        // Update existing file
        uploadRes = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${fileData.files[0].id}?uploadType=multipart`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          }
        );
      } else {
        // Create new file
        uploadRes = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          }
        );
      }

      if (uploadRes.ok) {
        triggerToast("Laporan berhasil dikirim ke Google Drive!", "ok");
      } else {
        const errData = await uploadRes.json();
        throw new Error(errData.error?.message || "Upload failed");
      }
    } catch (err: any) {
      console.error("Drive upload failed:", err);
      const errMsg = err.message || "";
      if (
        errMsg.includes("invalid_grant") ||
        errMsg.includes("expired") ||
        errMsg.includes("invalid authentication") ||
        errMsg.includes("401")
      ) {
        setDriveToken(null);
        localStorage.removeItem("smbr_drive_token");
        triggerToast("Sesi Google Drive berakhir, silakan hubungkan kembali.", "er");
      } else {
        triggerToast(`Gagal mengirim laporan ke Google Drive: ${errMsg}`, "er");
      }
    } finally {
      setIsDriveUploading(false);
    }
  };

  const handleToggleLockDate = async () => {
    if (!isMasterAdmin) return;
    const isCurrentlyLocked = !!lockedDates[selectedDate]?.locked;
    const actionText = isCurrentlyLocked ? "menjadi Unverified (buka kunci)" : "menjadi Verified (kunci)";
    
    setConfirmModal({
      isOpen: true,
      title: isCurrentlyLocked ? "Setel Status ke Unverified" : "Setel Status ke Verified",
      message: `Apakah Anda yakin ingin mengubah status laporan pada tanggal ${formatDateDisplay(selectedDate)} ${actionText}?`,
      onConfirm: async () => {
        try {
          const docRef = doc(db, "locked_dates", selectedDate);
          if (isCurrentlyLocked) {
            await setDoc(docRef, {
              locked: false,
              unlockedBy: currentUser?.email || "",
              unlockedAt: new Date().toISOString()
            }, { merge: true });
            triggerToast(`Status tanggal ${formatDateDisplay(selectedDate)} diubah menjadi Unverified.`, "ok");
          } else {
            await setDoc(docRef, {
              locked: true,
              lockedBy: currentUser?.email || "",
              lockedAt: new Date().toISOString()
            }, { merge: true });
            triggerToast(`Status tanggal ${formatDateDisplay(selectedDate)} diubah menjadi Verified.`, "ok");

            // Auto-upload to Drive for Admin Utama
            if (isMasterAdmin && driveToken) {
              try {
                triggerToast("Membuat laporan Excel...", "inf");
                const wb = await generateExcelReport(filteredReports, selectedDate, currentUser?.email, true);
                const buffer = await wb.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                console.log("Excel blob size:", blob.size, "bytes");
                triggerToast("Mengirim ke Google Drive...", "inf");
                await uploadToDrive(driveToken, blob, selectedDate);
              } catch (uploadErr: any) {
                console.error("Drive upload error detail:", uploadErr);
                triggerToast(`Gagal upload: ${uploadErr.message}`, "er");
              }
            }
          }
        } catch (err) {
          console.error("Toggle date lock failed:", err);
          triggerToast(`Gagal mengubah status tanggal`, "er");
          handleFirestoreError(err, OperationType.WRITE, `locked_dates/${selectedDate}`);
        }
      }
    });
  };

  // Date controls
  const handlePrevDay = () => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() - 1);
    setSelectedDate(getDateString(d));
  };

  const handleNextDay = () => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() + 1);
    setSelectedDate(getDateString(d));
  };

  const handleGoToday = () => {
    setSelectedDate(getDateString(new Date()));
  };

  // Filter current reports by selected date
  const filteredReports = reports.filter((r) => r.tanggal === selectedDate);
  const inputFilteredReports = filteredReports.filter((r) => {
    if (!userPabrikRole || isMasterAdmin) return true;
    return userAllowedPabrik.some(p => p === r.pabrik);
  });
  const isToday = selectedDate === getDateString(new Date());

  // Statistics calculation for the selected date
  const selectedDateStats = filteredReports.reduce(
    (acc, r) => {
      acc.utuh += r.utuh;
      acc.pecah += r.pecah;
      acc.sortir += r.sortir;
      acc.total += r.total;
      return acc;
    },
    { utuh: 0, pecah: 0, sortir: 0, total: 0 }
  );

  // Excel Export function
  const handleExportExcel = () => {
    if (filteredReports.length === 0) {
      triggerToast("Tidak ada data untuk diekspor pada tanggal ini", "er");
      return;
    }
    downloadExcelReport(filteredReports, selectedDate, currentUser?.email, isSelectedDateLocked);
  };

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#1a1814] flex flex-col selection:bg-brand-green selection:text-white scrollbar-hide">
      <style>{`
        html, body { overflow: hidden; height: 100%; }
        .scrollbar-hide { height: 100vh; overflow-y: auto; }
      `}</style>
      {/* Toast Wrapper */}
      <div className="fixed top-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 max-w-sm sm:w-80 mx-auto sm:mx-0 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50, y: -10 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 30 }}
              className={`p-4 rounded-xl shadow-lg border flex items-center gap-3 pointer-events-auto ${
                toast.type === "ok"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : toast.type === "er"
                  ? "bg-rose-50 border-rose-200 text-rose-800"
                  : "bg-sky-50 border-sky-200 text-sky-800"
              }`}
            >
              {toast.type === "ok" && <CheckCircle className="w-5 h-5 shrink-0 text-emerald-600" />}
              {toast.type === "er" && <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />}
              {toast.type === "inf" && <ShieldCheck className="w-5 h-5 shrink-0 text-sky-600" />}
              <span className="font-semibold text-sm">{toast.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col">
        {/* Loading overlay for authorization/auth states */}
        {authLoading ? (
          <div className="fixed inset-0 bg-[#faf9f6]/95 z-50 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-12 h-12 text-brand-green animate-spin" />
            <p className="font-bold text-[#1a1814] text-lg tracking-tight">Memuat Aplikasi...</p>
            <p className="text-xs text-[#9e9892]">Menghubungkan ke database aman Firebase</p>
          </div>
        ) : !currentUser ? (
          /* LOGIN & REGISTER PAGE */
          <div className="flex-1 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="bg-white border-2 border-[#e8e4de] rounded-3xl p-8 max-w-md w-full shadow-xl relative overflow-hidden"
            >
              {/* Subtle accent border on top */}
              <div className="absolute top-0 inset-x-0 h-2 bg-brand-green" />

              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white border border-[#e8e4de] p-1.5 shadow-sm mb-4">
                  {!logoErrorLogin ? (
                    <img 
                      src={logo}
                      alt="Semen Baturaja Logo" 
                      className="w-full h-full object-contain"
                      onError={() => setLogoErrorLogin(true)}
                    />
                  ) : (
                    <div className="w-full h-full rounded-xl bg-gradient-to-tr from-[#e8f0e6] to-[#faf9f7] flex flex-col items-center justify-center border border-brand-green/20">
                      <span className="text-xl font-black text-brand-green leading-none">SB</span>
                      <span className="text-[8px] font-black text-brand-green/70 uppercase tracking-widest mt-0.5">SMBR</span>
                    </div>
                  )}
                </div>
                <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#1a1814] mb-1 whitespace-nowrap">
                  PACKAGING <span className="text-brand-green">MANAGEMENT</span>
                </h1>
                <h2 className="text-sm font-bold text-[#6b6560] tracking-tight uppercase mb-4">
                  Laporan Pemakaian Kantong
                </h2>
                <p className="text-xs text-[#6b6560] leading-relaxed">
                  Silakan masuk dengan akun terdaftar untuk mengakses database.
                </p>
              </div>

              {authError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex flex-col gap-2 text-xs font-semibold mb-6"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{authError}</span>
                  </div>
                  {authError.includes("belum diaktifkan") && !authError.includes("Tamu") && (
                    <div className="mt-2 pt-2 border-t border-rose-200/50 flex flex-col gap-2 font-normal text-rose-900 leading-relaxed text-left">
                      <p className="font-bold">Cara Mengaktifkan di Firebase Console:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Buka halaman autentikasi proyek Firebase Anda.</li>
                        <li>Pilih tab <strong>Sign-in method</strong>.</li>
                        <li>Klik tombol <strong>Add new provider</strong> dan pilih <strong>Email/Password</strong>.</li>
                        <li>Aktifkan opsi pertama (Email/password) lalu klik <strong>Save</strong>.</li>
                      </ol>
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                        target="_blank"
                        referrerPolicy="no-referrer"
                        className="mt-1.5 self-start inline-flex items-center gap-1 bg-brand-green hover:bg-brand-green-hover text-white px-3.5 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer"
                      >
                        🔑 Buka Firebase Authentication Console
                      </a>
                    </div>
                  )}
                  {authError.includes("Tamu") && authError.includes("belum diaktifkan") && (
                    <div className="mt-2 pt-2 border-t border-rose-200/50 flex flex-col gap-2 font-normal text-rose-900 leading-relaxed text-left">
                      <p className="font-bold">Cara Mengaktifkan Login Tamu di Firebase Console:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Buka halaman autentikasi proyek Firebase Anda.</li>
                        <li>Pilih tab <strong>Sign-in method</strong>.</li>
                        <li>Klik tombol <strong>Add new provider</strong> dan pilih <strong>Anonymous</strong>.</li>
                        <li>Aktifkan sakelar <strong>Enable</strong> lalu klik <strong>Save</strong>.</li>
                      </ol>
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                        target="_blank"
                        referrerPolicy="no-referrer"
                        className="mt-1.5 self-start inline-flex items-center gap-1 bg-brand-green hover:bg-brand-green-hover text-white px-3.5 py-2 rounded-lg font-bold text-xs transition-all cursor-pointer"
                      >
                        🔑 Buka Firebase Authentication Console
                      </a>
                    </div>
                  )}
                </motion.div>
              )}

              <form onSubmit={handleAuth} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-[#6b6560] uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-[#9e9892]" />
                    <input
                      type="email"
                      required
                      placeholder="nama@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-sm font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors placeholder:text-[#c4bfb7]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[#6b6560] uppercase tracking-wider mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-[#9e9892]" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-sm font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors placeholder:text-[#c4bfb7]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full bg-brand-green hover:bg-brand-green-hover text-white py-3.5 px-6 rounded-xl font-bold text-sm tracking-wide shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogIn className="w-4.5 h-4.5" />
                  Masuk Ke Aplikasi
                </button>
              </form>

              <div className="flex items-center my-5">
                <div className="flex-1 border-t border-[#e8e4de]" />
                <span className="px-3 text-[10px] text-[#9e9892] font-bold uppercase tracking-wider">Atau</span>
                <div className="flex-1 border-t border-[#e8e4de]" />
              </div>

              <button
                type="button"
                onClick={handleGuestLogin}
                disabled={authLoading}
                className="w-full border-2 border-brand-green/30 hover:border-brand-green/70 bg-white hover:bg-brand-green-light/20 text-brand-green py-3 px-4 sm:px-6 rounded-xl font-bold text-xs sm:text-sm tracking-wide shadow-xs hover:shadow-sm active:translate-y-0 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                Masuk Sebagai Tamu
              </button>
            </motion.div>
          </div>
        ) : isAllowed === false ? (
          /* UNAUTHORIZED USER SCREEN */
          <div className="flex-1 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white border-2 border-[#e8e4de] rounded-3xl p-8 max-w-md w-full shadow-xl text-center relative"
            >
              <div className="absolute top-0 inset-x-0 h-2 bg-rose-500" />
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 mb-6">
                <ShieldAlert className="w-10 h-10 animate-pulse" />
              </div>

              <h2 className="text-xl font-extrabold text-[#1a1814] mb-3">Akses Ditangguhkan</h2>
              <p className="text-sm text-[#6b6560] leading-relaxed mb-6">
                Akun Anda <span className="font-bold text-[#1a1814]">{currentUser.email}</span> berhasil masuk, tetapi <span className="text-rose-600 font-bold">belum diizinkan</span> untuk mengakses atau memperbarui database.
              </p>

              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-800 font-medium text-left mb-6 leading-relaxed">
                Silakan hubungi Administrator sistem (<span className="font-bold">managementpackaging@gmail.com</span>) untuk mengizinkan alamat email Anda di daftar otorisasi.
              </div>

              <div className="flex flex-col gap-2.5">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full bg-[#1a1814] hover:bg-[#2b2823] text-white py-3 px-4 rounded-xl text-xs font-bold transition-all"
                >
                  🔄 Refresh Status Izin
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full border-2 border-[#e8e4de] hover:bg-rose-50 hover:text-rose-800 text-[#6b6560] py-3 px-4 rounded-xl text-xs font-bold transition-all"
                >
                  🚪 Keluar Akun
                </button>
              </div>
            </motion.div>
          </div>
        ) : (
          /* APP WORKSPACE FOR AUTHORIZED USER */
          <div className="flex-1 flex flex-col pb-24 md:pb-8">
            {/* Header section */}
            <header className="border-b border-[#e8e4de] bg-white sticky top-0 z-10 shadow-xs">
              <div className="max-w-7xl mx-auto px-4 md:px-6 h-18 flex items-center justify-between gap-2 sm:gap-4">
                {/* Brand Logo */}
                <div className="flex items-center shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-white border border-[#e8e4de] flex items-center justify-center p-0.5 shadow-sm overflow-hidden">
                    {!logoErrorHeader ? (
                      <img 
                        src={logo}
                        alt="Semen Baturaja Logo" 
                        className="w-full h-full object-contain"
                        onError={() => setLogoErrorHeader(true)}
                      />
                    ) : (
                      <div className="w-full h-full rounded-lg bg-gradient-to-tr from-[#e8f0e6] to-[#faf9f7] flex flex-col items-center justify-center border border-brand-green/20">
                        <span className="text-[13px] font-black text-brand-green leading-none">SB</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Centered Title & User Info */}
                <div className="flex-1 min-w-0 flex flex-col items-center md:items-start justify-center text-center md:text-left px-1 sm:px-2">
                  <h1 className="text-sm sm:text-lg md:text-xl font-extrabold leading-tight tracking-tight text-[#1a1814] uppercase">
                    LAPORAN <span className="text-brand-green">PEMAKAIAN KANTONG</span>
                  </h1>
                  <div className="text-[11px] sm:text-xs text-[#9e9892] font-semibold flex items-center justify-center md:justify-start gap-1 w-full min-w-0 mt-0.5">
                    <UserCheck className={`w-3 h-3 shrink-0 ${isGuest ? "text-blue-600" : isMasterAdmin ? "text-emerald-600" : "text-sky-600"}`} />
                    <span className="truncate max-w-[100px] xs:max-w-[140px] sm:max-w-none">
                      {isGuest ? "Tamu (Guest)" : currentUser?.email}
                    </span>
                    <span className="text-[#c4bfb7] shrink-0">•</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold tracking-wider shrink-0 border ${
                      isMasterAdmin
                        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                        : isAdmin
                          ? "text-sky-700 bg-sky-50 border-sky-200"
                          : "text-blue-700 bg-blue-50 border-blue-200"
                    }`}>
                      {ROLE_MAP[userRole || 'guest'] || 'Tamu'}
                    </span>
                    {userPabrikRole && PABRIK_ROLE_MAP[userPabrikRole] && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold tracking-wider shrink-0 border ${PABRIK_ROLE_MAP[userPabrikRole].color} ${PABRIK_ROLE_MAP[userPabrikRole].bgColor} ${PABRIK_ROLE_MAP[userPabrikRole].borderColor}`}>
                        {PABRIK_ROLE_MAP[userPabrikRole].label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Navigation and Date filter controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Desktop navigation tabs */}
                  <div className="hidden md:flex items-center gap-1 mr-4 border-r border-[#e8e4de] pr-4">
                    <button
                      onClick={() => setActiveTab("dash")}
                      className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer ${
                        activeTab === "dash"
                          ? "bg-brand-green text-white shadow-sm"
                          : "text-[#6b6560] hover:bg-[#faf9f6] hover:text-[#1a1814]"
                      }`}
                    >
                      <BarChart3 className="w-4.5 h-4.5" />
                      Dashboard
                    </button>
                    {!isGuest && (
                      <button
                        onClick={() => setActiveTab("input")}
                        className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer ${
                          activeTab === "input"
                            ? "bg-brand-green text-white shadow-sm"
                            : "text-[#6b6560] hover:bg-[#faf9f6] hover:text-[#1a1814]"
                        }`}
                      >
                        <FileText className="w-4.5 h-4.5" />
                        Pelaporan
                      </button>
                    )}
                    {isMasterAdmin && (
                      <button
                        onClick={() => setActiveTab("users")}
                        className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all ${
                          activeTab === "users"
                            ? "bg-brand-green text-white shadow-sm"
                            : "text-[#6b6560] hover:bg-[#faf9f6] hover:text-[#1a1814]"
                        }`}
                      >
                        <Users className="w-4.5 h-4.5" />
                        Manajemen User
                      </button>
                    )}
                  </div>

                  {/* Log out action */}
                  <button
                    onClick={handleLogout}
                    title="Log Out"
                    className="shrink-0 p-2 border-2 border-[#e8e4de] text-[#6b6560] hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 rounded-xl transition-all"
                  >
                    <LogOut className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            </header>

            {/* Sub-header with Date Navigation & Controls */}
            {activeTab !== "users" && (
              <div className="bg-white border-b border-[#e8e4de] py-3 shadow-xs">
                <div className="max-w-7xl mx-auto px-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
                  {/* Datepicker Navigation */}
                  <div className="flex items-center gap-1 border border-[#e8e4de] bg-[#fcfbfa] p-1.5 rounded-2xl w-full sm:w-auto shadow-xs">
                    <button
                      onClick={handlePrevDay}
                      className="p-1.5 border border-[#e8e4de] hover:bg-[#faf9f7] rounded-xl text-[#6b6560] hover:text-[#1a1814] active:scale-95 transition-all"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>

                    <div className="flex-1 flex items-center justify-center min-w-[160px]">
                      <div className="flex items-center bg-white border border-brand-green/30 shadow-xs rounded-xl p-1 px-3 cursor-pointer hover:shadow-md transition-all hover:border-brand-green/60 gap-2 relative">
                        <div className="text-xs text-brand-green font-bold uppercase tracking-wider pr-2 border-r border-slate-200 leading-none shrink-0 font-sans">
                          {formatDateDisplay(selectedDate).split(",")[0]}
                        </div>
                        <div className="flex items-center gap-1.5 flex-1">
                          <CalendarIcon className="w-3.5 h-3.5 text-[#9e9892]" />
                          <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent border-none text-[13px] font-extrabold text-[#1a1814] focus:outline-none cursor-pointer w-full font-sans"
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleNextDay}
                      className="p-1.5 border border-[#e8e4de] hover:bg-[#faf9f7] rounded-xl text-[#6b6560] hover:text-[#1a1814] active:scale-95 transition-all"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Today shortcuts, Excel Export & Verification Lock */}
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-center sm:justify-end">
                    <button
                      onClick={handleGoToday}
                      className={`border transition-all px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold cursor-pointer ${
                        isToday
                          ? "border-brand-green bg-[#e8f0e6] text-brand-green"
                          : "border-[#e8e4de] bg-white hover:border-brand-green/50 text-[#6b6560] hover:text-[#1a1814] hover:bg-[#faf9f7]"
                      }`}
                    >
                      Hari Ini
                    </button>
                    {isMasterAdmin && (
                      <button
                        onClick={handleLoginDrive}
                        className={`border transition-all px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                          driveToken
                            ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                            : "border-[#e8e4de] bg-white hover:border-sky-300 text-[#6b6560] hover:text-sky-700 hover:bg-sky-50"
                        }`}
                        title={driveToken ? "Sudah Terhubung ke Drive" : "Hubungkan ke Drive"}
                      >
                        <Cloud className={`w-4 h-4 ${driveToken ? "text-sky-600" : ""}`} />
                        {driveToken ? "Drive Connected" : "Connect Drive"}
                      </button>
                    )}
                    <button
                      onClick={handleExportExcel}
                      className="border border-[#e8e4de] bg-[#e8f0e6] hover:bg-brand-green-light text-brand-green px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      Export Excel
                    </button>

                    {/* Verification status badge or action */}
                    {isMasterAdmin ? (
                      <button
                        onClick={handleToggleLockDate}
                        className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          isSelectedDateLocked
                            ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                            : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        {isSelectedDateLocked ? (
                          <>
                            <Lock className="w-3.5 h-3.5 text-rose-600" />
                            <span>Verified (Buka)</span>
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Unverified (Kunci)</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-bold border select-none ${
                          isSelectedDateLocked
                            ? "border-rose-200 bg-rose-50/50 text-rose-700"
                            : "border-amber-200 bg-amber-50/50 text-amber-700"
                        }`}
                      >
                        {isSelectedDateLocked ? (
                          <>
                            <Lock className="w-3.5 h-3.5 text-rose-600" />
                            <span>Verified</span>
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Unverified</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Main viewports */}
            <main className="flex-1 max-w-7xl mx-auto px-4 md:px-6 pt-3 pb-10 w-full">
              {/* Locked/Verified Banner */}
              <AnimatePresence>
                {showLockedAlert && isSelectedDateLocked && (
                  <motion.div
                    initial={{ opacity: 0, y: -20, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto", marginBottom: 24 }}
                    exit={{ opacity: 0, y: -20, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl p-4 flex items-start gap-3 shadow-xs">
                      <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <p className="font-extrabold text-[#1a1814] mb-0.5">
                          Status Laporan: Verified
                        </p>
                        <p className="text-rose-700">
                          Seluruh data laporan pada tanggal <span className="font-extrabold">{formatDateDisplay(selectedDate)}</span> telah diverifikasi (Verified) oleh Admin Utama. {isMasterAdmin ? "Sebagai Admin Utama, Anda dapat mengubah data ini jika diperlukan, namun disarankan untuk mengubah status menjadi Unverified terlebih dahulu." : "Data tidak dapat ditambahkan, diubah, atau dihapus."}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Data Loading Progress Bar */}
              {dataLoading && (
                <div className="bg-white border-2 border-[#e8e4de] rounded-2xl p-6 text-center shadow-xs mb-6 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-8 h-8 text-brand-green animate-spin" />
                  <p className="text-xs text-[#6b6560] font-bold">Sinkronisasi Firestore real-time...</p>
                </div>
              )}

              {/* VIEWPORTS CONTAINER */}
              <AnimatePresence mode="wait">
                {/* VIEWPORT: DASHBOARD */}
                {activeTab === "dash" && (
                  <motion.div
                    key="dash"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-8"
                  >
                    {filteredReports.length === 0 ? (
                      <div className="bg-white border-2 border-[#e8e4de] rounded-3xl p-12 text-center shadow-xs">
                        <div className="flex justify-center mb-4 animate-pulse">
                          <div className="p-4 bg-[#e8f0e6]/40 text-brand-green border-2 border-brand-green/20 rounded-2xl">
                            <FileText className="w-8 h-8" />
                          </div>
                        </div>
                        <h4 className="text-sm font-extrabold text-[#1a1814]">Belum Ada Laporan Pemakaian</h4>
                        <p className="text-xs text-[#5c554f] mt-1.5 max-w-sm mx-auto leading-relaxed">
                          Tidak ada laporan pemakaian kantong untuk tanggal{" "}
                          <span className="font-extrabold text-[#1a1814] bg-[#e8f0e6] px-1.5 py-0.5 rounded-md inline-block">
                            {formatDateDisplay(selectedDate)}
                          </span>.
                          {!isGuest && (
                            <span className="block mt-1.5 text-[#9e9892] text-[11px] font-medium">
                              Silakan buka tab <span className="font-bold text-brand-green">Pelaporan</span> untuk menambahkan data baru.
                            </span>
                          )}
                        </p>
                      </div>
                    ) : (
                      effectivePabrikList.map((pabrikName) => {
                        // Aggregate data per bag type for this factory
                        const factoryReports = filteredReports.filter((r) => r.pabrik === pabrikName);

                        // Global factory aggregation per bag type
                        const grandFactoryAgg = effectiveJenisKantong.reduce((acc, name) => {
                          acc[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0, vendors: {} };
                          return acc;
                        }, {} as Record<string, { utuh: number; pecah: number; sortir: number; total: number, vendors: Record<string, { utuh: number; pecah: number; sortir: number; total: number }> }>);

                        factoryReports.forEach((r) => {
                          if (grandFactoryAgg[r.nama]) {
                            const agg = grandFactoryAgg[r.nama];
                            agg.utuh += r.utuh;
                            agg.pecah += r.pecah;
                            agg.sortir += r.sortir;
                            agg.total += r.total;

                            if (!agg.vendors[r.vendor]) {
                              agg.vendors[r.vendor] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
                            }
                            agg.vendors[r.vendor].utuh += r.utuh;
                            agg.vendors[r.vendor].pecah += r.pecah;
                            agg.vendors[r.vendor].sortir += r.sortir;
                            agg.vendors[r.vendor].total += r.total;
                          }
                        });

                        if (factoryReports.length === 0) return null;

                        return (
                          <div key={pabrikName} className="bg-white border-2 border-[#e8e4de] rounded-3xl p-4 md:p-6 shadow-xs space-y-6">
                            {/* Factory Header */}
                            <div className="flex items-center gap-2 pb-3 border-b-2 border-[#faf9f6]">
                              <span className="text-lg">🏭</span>
                              <h2 className="text-base font-extrabold text-[#1a1814]">{pabrikName}</h2>
                              <span className="ml-auto text-xs bg-brand-green-light text-brand-green font-semibold px-2 py-0.5 rounded-full">
                                {factoryReports.length} laporan
                              </span>
                            </div>


                            {/* Consolidated Factory Bag Usage Grid/Table */}
                            <div className="space-y-2 -mt-4">
                              <h3 className="text-sm font-extrabold text-[#6b6560] tracking-wide uppercase mb-2 text-center [text-shadow:0_1px_0_rgba(255,255,255,0.8)]">TOTAL PEMAKAIAN KANTONG</h3>
                              <div className="border border-brand-green/30 rounded-2xl overflow-hidden bg-[#fdfcfb]">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className="bg-[#faf9f7] text-[#6b6560] uppercase text-[10px] sm:text-xs font-semibold border-b border-[#e8e4de]">
                                        <th className="py-2.5 px-2 sm:px-4 font-semibold text-[#1a1814]">Jenis Kantong</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-semibold text-brand-green text-center">Utuh</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-semibold text-rose-600 text-center">Pecah</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-semibold text-amber-600 text-center">Sortir</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-semibold text-[#1a1814] text-center">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8e4de]">
                                      {effectiveJenisKantong.map((name, idx) => {
                                        const stat = grandFactoryAgg[name];
                                        const isZero = stat.utuh === 0 && stat.pecah === 0 && stat.sortir === 0;
                                        const isExpanded = !isZero && expandedBagTypes[name];
                                        return (
                                          <React.Fragment key={name}>
                                            <tr 
                                              className={`hover:bg-[#faf9f7]/50 transition-colors ${!isZero ? 'cursor-pointer' : 'cursor-default'} ${isExpanded ? 'bg-[#faf9f7] ring-2 ring-inset ring-brand-green/50' : ''}`}
                                              onClick={() => {
                                                if (!isZero) {
                                                  setExpandedBagTypes(prev => ({ ...prev, [name]: !prev[name] }));
                                                }
                                              }}
                                            >
                                              <td className="py-2 px-2 sm:px-4 font-bold text-[#1a1814] text-xs sm:text-sm">
                                                {JENIS_KANTONG_SHORT[idx]}
                                                {!isZero && (
                                                  <span className="ml-2 text-xs text-[#9e9892]">{isExpanded ? '▼' : '▶'}</span>
                                                )}
                                              </td>
                                              <td className={`py-2 px-2 sm:px-4 text-center font-semibold text-xs sm:text-sm ${isZero ? "text-[#c4bfb7]" : "text-[#1a1814]"}`}>
                                                {stat.utuh.toLocaleString()}
                                              </td>
                                              <td className={`py-2 px-2 sm:px-4 text-center font-semibold text-xs sm:text-sm ${isZero ? "text-[#c4bfb7]" : "text-rose-600"}`}>
                                                {stat.pecah.toLocaleString()}
                                              </td>
                                              <td className={`py-2 px-2 sm:px-4 text-center font-semibold text-xs sm:text-sm ${isZero ? "text-[#c4bfb7]" : "text-amber-600"}`}>
                                                {stat.sortir.toLocaleString()}
                                              </td>
                                              <td className={`py-2 px-2 sm:px-4 text-center font-extrabold text-xs sm:text-sm bg-[#e8f0e6]/20 ${isZero ? "text-[#c4bfb7]" : "text-brand-green"}`}>
                                                {stat.total.toLocaleString()}
                                              </td>
                                            </tr>
                                            {isExpanded && Object.entries(stat.vendors).map(([vendorName, vStat]) => (
                                              <tr key={`${name}-${vendorName}`} className="bg-[#fdfcfb]">
                                                <td className="py-1 px-4 sm:px-6 text-[10px] text-[#9e9892] italic pl-8">↳ {vendorName}</td>
                                                <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892]">{vStat.utuh.toLocaleString()}</td>
                                                <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892]">{vStat.pecah.toLocaleString()}</td>
                                                <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892]">{vStat.sortir.toLocaleString()}</td>
                                                <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892] font-semibold">{vStat.total.toLocaleString()}</td>
                                              </tr>
                                            ))}
                                          </React.Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>

                            {/* Shift Report Section */}
                            {(() => {
                              const shiftData = SHIFT_INFO.map(shift => {
                                const shiftReports = factoryReports.filter(r => r.shift === shift.id);
                                if (shiftReports.length === 0) return null;

                                const shiftAgg = effectiveJenisKantong.reduce((acc, name) => {
                                  acc[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0, vendors: {} };
                                  return acc;
                                }, {} as Record<string, { utuh: number; pecah: number; sortir: number; total: number; vendors: Record<string, { utuh: number; pecah: number; sortir: number; total: number }> }>);

                                shiftReports.forEach(r => {
                                  if (shiftAgg[r.nama]) {
                                    shiftAgg[r.nama].utuh += r.utuh;
                                    shiftAgg[r.nama].pecah += r.pecah;
                                    shiftAgg[r.nama].sortir += r.sortir;
                                    shiftAgg[r.nama].total += r.total;
                                    if (!shiftAgg[r.nama].vendors[r.vendor]) {
                                      shiftAgg[r.nama].vendors[r.vendor] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
                                    }
                                    shiftAgg[r.nama].vendors[r.vendor].utuh += r.utuh;
                                    shiftAgg[r.nama].vendors[r.vendor].pecah += r.pecah;
                                    shiftAgg[r.nama].vendors[r.vendor].sortir += r.sortir;
                                    shiftAgg[r.nama].vendors[r.vendor].total += r.total;
                                  }
                                });

                                return { shift, reports: shiftReports, agg: shiftAgg };
                              }).filter(Boolean);

                              if (shiftData.length === 0) return null;

                              return (
                                <div className="space-y-2 -mt-2">
                                  <h3 className="text-sm font-extrabold text-[#6b6560] tracking-wide uppercase mb-2 text-center [text-shadow:0_1px_0_rgba(255,255,255,0.8)]">LAPORAN PER SHIFT</h3>
                                  {shiftData.map(({ shift, reports: sReports, agg: shiftAgg }) => {
                                    const shiftKey = `${pabrikName}-${shift!.id}`;
                                    const isShiftExpanded = expandedShifts[shiftKey];
                                    return (
                                      <div key={shift!.id} className="border border-amber-200/60 rounded-2xl overflow-hidden bg-[#fffdf5]">
                                        <div 
                                          className="flex items-center gap-2 px-4 py-2.5 bg-amber-50/80 cursor-pointer hover:bg-amber-50 transition-colors"
                                          onClick={() => setExpandedShifts(prev => ({ ...prev, [shiftKey]: !prev[shiftKey] }))}
                                        >
                                          <span className="text-sm">⏰</span>
                                          <span className="text-xs font-bold text-amber-800">{shift!.label} ({shift!.time})</span>
                                          <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">{sReports.length} laporan</span>
                                          <span className="text-xs text-amber-600">{isShiftExpanded ? '▼' : '▶'}</span>
                                        </div>
                                        {isShiftExpanded && (
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-left text-xs border-collapse">
                                              <thead>
                                                <tr className="bg-[#faf9f7] text-[#6b6560] uppercase text-[10px] sm:text-xs font-semibold border-b border-[#e8e4de]">
                                                  <th className="py-2 px-2 sm:px-4 font-semibold text-[#1a1814]">Jenis Kantong</th>
                                                  <th className="py-2 px-2 sm:px-4 font-semibold text-brand-green text-center">Utuh</th>
                                                  <th className="py-2 px-2 sm:px-4 font-semibold text-rose-600 text-center">Pecah</th>
                                                  <th className="py-2 px-2 sm:px-4 font-semibold text-amber-600 text-center">Sortir</th>
                                                  <th className="py-2 px-2 sm:px-4 font-semibold text-[#1a1814] text-center">Total</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-[#e8e4de]">
                                                {effectiveJenisKantong.map((name, idx) => {
                                                  const stat = shiftAgg[name];
                                                  const isZero = stat.total === 0;
                                                  const isShiftBagExpanded = expandedBagTypes[`shift-${shiftKey}-${name}`];
                                                  if (isZero) return null;
                                                  return (
                                                    <React.Fragment key={name}>
                                                      <tr 
                                                        className="hover:bg-[#faf9f7]/50 transition-colors cursor-pointer"
                                                        onClick={() => setExpandedBagTypes(prev => ({ ...prev, [`shift-${shiftKey}-${name}`]: !prev[`shift-${shiftKey}-${name}`] }))}
                                                      >
                                                        <td className="py-1.5 px-2 sm:px-4 font-bold text-[#1a1814] text-xs">
                                                          {JENIS_KANTONG_SHORT[idx]}
                                                          <span className="ml-2 text-[10px] text-[#9e9892]">{isShiftBagExpanded ? '▼' : '▶'}</span>
                                                        </td>
                                                        <td className="py-1.5 px-2 sm:px-4 text-center font-semibold text-xs text-[#1a1814]">{stat.utuh.toLocaleString()}</td>
                                                        <td className="py-1.5 px-2 sm:px-4 text-center font-semibold text-xs text-rose-600">{stat.pecah.toLocaleString()}</td>
                                                        <td className="py-1.5 px-2 sm:px-4 text-center font-semibold text-xs text-amber-600">{stat.sortir.toLocaleString()}</td>
                                                        <td className="py-1.5 px-2 sm:px-4 text-center font-extrabold text-xs text-brand-green">{stat.total.toLocaleString()}</td>
                                                      </tr>
                                                      {isShiftBagExpanded && Object.entries(stat.vendors).map(([vendorName, vStat]) => (
                                                        <tr key={`${name}-${vendorName}`} className="bg-[#fdfcfb]">
                                                          <td className="py-1 px-4 sm:px-6 text-[10px] text-[#9e9892] italic pl-8">↳ {vendorName}</td>
                                                          <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892]">{vStat.utuh.toLocaleString()}</td>
                                                          <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892]">{vStat.pecah.toLocaleString()}</td>
                                                          <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892]">{vStat.sortir.toLocaleString()}</td>
                                                          <td className="py-1 px-2 sm:px-4 text-center text-[10px] text-[#9e9892] font-semibold">{vStat.total.toLocaleString()}</td>
                                                        </tr>
                                                      ))}
                                                    </React.Fragment>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })
                    )}
                  </motion.div>
                )}

                {/* VIEWPORT: PELAPORAN DATA LIST */}
                {activeTab === "input" && !isGuest && (
                  <motion.div
                    key="input"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1"
                  >
                    <div className="flex items-center justify-between gap-4 pt-0 pb-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <h2 className="text-xs font-bold text-[#6b6560] tracking-widest uppercase">
                          Daftar Laporan
                        </h2>
                        <div className="h-4 w-[1px] bg-[#e8e4de] hidden sm:block"></div>
                        <div className="text-sm font-extrabold text-[#1a1814] flex items-center gap-1.5">
                          <CalendarIcon className="w-3.5 h-3.5 text-brand-green" />
                          {formatDateDisplay(selectedDate)}
                        </div>
                      </div>
                      {!isGuest && (
                        <button
                          onClick={handleOpenAddForm}
                          disabled={isSelectedDateLocked && !isMasterAdmin}
                          className={`h-10 px-5 rounded-xl font-bold text-[13px] flex items-center gap-2 shadow-sm transition-all cursor-pointer active:scale-95 ${
                            isSelectedDateLocked && !isMasterAdmin
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200 shadow-none"
                              : "bg-brand-green hover:bg-brand-green-hover text-white hover:shadow-md"
                          }`}
                        >
                          {isSelectedDateLocked && !isMasterAdmin ? (
                            <>
                              <Lock className="w-4 h-4 text-slate-400" />
                              <span>Verified</span>
                            </>
                          ) : (
                            <>
                              <div className="bg-white/20 p-0.5 rounded-md">
                                <Plus className="w-4 h-4" />
                              </div>
                              <span>Tambah Data Baru</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {inputFilteredReports.length === 0 ? (
                      <div className="bg-white border-2 border-[#e8e4de] rounded-3xl p-12 text-center shadow-xs">
                        <div className="flex justify-center mb-4 animate-pulse">
                          <div className="p-4 bg-[#e8f0e6]/40 text-brand-green border-2 border-brand-green/20 rounded-2xl">
                            <FileText className="w-8 h-8" />
                          </div>
                        </div>
                        <h4 className="text-sm font-extrabold text-[#1a1814]">Belum Ada Data</h4>
                        <p className="text-xs text-[#9e9892] mt-1 max-w-sm mx-auto">
                          Belum ada laporan pemakaian kantong untuk tanggal ini{userPabrikRole ? ' untuk pabrik Anda' : ''}. Klik tombol <span className="font-bold text-brand-green">Tambah Data Baru</span> di atas untuk menginput laporan.
                        </p>
                      </div>
                    ) : (
                      <>
                        {(userPabrikRole ? userAllowedPabrik : effectivePabrikList).map((pabrikName) => {
                          const pbrReports = inputFilteredReports.filter(r => r.pabrik === pabrikName);
                          const pbrStats = pbrReports.reduce((acc, r) => ({
                            utuh: acc.utuh + r.utuh,
                            pecah: acc.pecah + r.pecah,
                            sortir: acc.sortir + r.sortir,
                            total: acc.total + r.total
                          }), { utuh: 0, pecah: 0, sortir: 0, total: 0 });

                          if (pbrReports.length === 0) return null;

                          return (
                            <div key={pabrikName} className="space-y-2">
                              <h3 className="text-center text-sm font-extrabold text-[#6b6560] tracking-wide uppercase">Data Laporan {pabrikName}</h3>
                              
                              {/* Desktop Table View */}
                              <div className="hidden md:block bg-white border-2 border-[#e8e4de] rounded-3xl shadow-xs overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className="bg-[#faf9f7] border-b border-[#e8e4de] text-[#6b6560] font-semibold uppercase text-[10px] tracking-wider">
                                        <th className="py-3 px-4 text-center w-12">No</th>
                                        <th className="py-3 px-4">Vendor</th>
                                        <th className="py-3 px-4">Jenis Kantong</th>
                                        <th className="py-3 px-4">Pabrik</th>
                                        <th className="py-3 px-4 text-center">Shift</th>
                                        <th className="py-3 px-4 text-center text-brand-green">Utuh</th>
                                        <th className="py-3 px-4 text-center text-rose-600">Pecah</th>
                                        <th className="py-3 px-4 text-center text-amber-600">Sortir</th>
                                        <th className="py-3 px-4 text-center font-extrabold">Total</th>
                                        <th className="py-3 px-4">Oleh</th>
                                        {!isGuest && <th className="py-3 px-4 text-center w-28">Aksi</th>}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8e4de]">
                                      {pbrReports.map((item, index) => (
                                        <tr key={item.id} className="hover:bg-[#faf9f7]/50 transition-colors">
                                          <td className="py-2.5 px-4 text-center font-bold text-[#9e9892]">{index + 1}</td>
                                          <td className="py-2.5 px-4 font-extrabold text-brand-green text-[13px]">{item.vendor}</td>
                                          <td className="py-2.5 px-4 font-bold text-[#1a1814]">{item.nama}</td>
                                          <td className="py-2.5 px-4 font-medium text-[#6b6560] text-xs">
                                            {item.pabrik.match(/\(([^)]+)\)/)?.[1] || item.pabrik}
                                          </td>
                                          <td className="py-2.5 px-4 text-center">
                                            <span
                                              className={`inline-block px-2 py-0.5 rounded-md font-semibold text-xs border ${
                                                item.shift === 1
                                                  ? "text-blue-600 bg-blue-50 border-blue-200"
                                                  : item.shift === 2
                                                  ? "text-purple-600 bg-purple-50 border-purple-200"
                                                  : "text-amber-600 bg-amber-50 border-amber-200"
                                              }`}
                                            >
                                              S{item.shift}
                                            </span>
                                          </td>
                                          <td className="py-2.5 px-4 text-center font-bold text-brand-green">{item.utuh}</td>
                                          <td className="py-2.5 px-4 text-center font-bold text-rose-600">{item.pecah}</td>
                                          <td className="py-2.5 px-4 text-center font-bold text-amber-600">{item.sortir}</td>
                                          <td className="py-2.5 px-4 text-center font-extrabold bg-[#e8f0e6]/20 text-[#1a1814]">
                                            {item.total}
                                          </td>
                                          <td className="py-2.5 px-4 text-xs text-[#6b6560] font-medium max-w-[120px] truncate" title={item.createdBy || "Sistem"}>
                                            {item.createdBy?.split("@")[0] || "Sistem"}
                                          </td>
                                          {!isGuest && (
                                            <td className="py-2.5 px-4 text-center">
                                              <div className="flex items-center justify-center gap-1.5">
                                                <button
                                                  onClick={() => handleOpenEditForm(item)}
                                                  disabled={isSelectedDateLocked && !isMasterAdmin}
                                                  className={`p-1.5 border rounded-lg transition-all cursor-pointer ${
                                                    isSelectedDateLocked && !isMasterAdmin
                                                      ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
                                                      : "border-[#e8e4de] hover:border-brand-green hover:bg-brand-green-light text-[#6b6560] hover:text-brand-green"
                                                  }`}
                                                  title={isSelectedDateLocked && !isMasterAdmin ? "Data Verified (Terkunci)" : "Edit Baris"}
                                                >
                                                  <Edit2 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  onClick={() => handleDeleteEntry(item.id)}
                                                  disabled={isSelectedDateLocked && !isMasterAdmin}
                                                  className={`p-1.5 border rounded-lg transition-all cursor-pointer ${
                                                    isSelectedDateLocked && !isMasterAdmin
                                                      ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
                                                      : "border-[#e8e4de] hover:border-rose-200 hover:bg-rose-50 text-[#6b6560] hover:text-rose-600"
                                                  }`}
                                                  title={isSelectedDateLocked && !isMasterAdmin ? "Data Verified (Terkunci)" : "Hapus Baris"}
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                            </td>
                                          )}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {/* Mobile Card View */}
                              <div className="block md:hidden space-y-4">
                                {pbrReports.map((item, index) => (
                                  <div key={item.id} className="bg-white border-2 border-[#e8e4de] rounded-2xl p-4 shadow-xs space-y-3 relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-1.5 h-full bg-brand-green" />
                                    <div className="flex items-center justify-between pl-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-bold text-[#9e9892] bg-[#faf9f7] px-1.5 py-0.5 rounded-md border border-[#e8e4de]">
                                          #{index + 1}
                                        </span>
                                        <span className="font-extrabold text-brand-green text-sm tracking-tight">{item.vendor}</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[#6b6560] font-semibold text-[10px] uppercase">
                                          {item.pabrik.includes("1") ? "PBR 1" : "PBR 2"}
                                        </span>
                                        <span
                                          className={`px-1.5 py-0.5 rounded font-semibold text-[10px] border ${
                                            item.shift === 1
                                              ? "text-blue-600 bg-blue-50 border-blue-200"
                                              : item.shift === 2
                                              ? "text-purple-600 bg-purple-50 border-purple-200"
                                              : "text-amber-600 bg-amber-50 border-amber-200"
                                          }`}
                                        >
                                          Shift {item.shift}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="text-xs font-bold text-[#1a1814] pl-2 border-l-2 border-[#e8e4de]">
                                      {item.nama}
                                    </div>

                                    {/* Bag counts grid */}
                                    <div className="grid grid-cols-4 gap-1.5 bg-[#faf9f7] p-2 rounded-xl border border-[#e8e4de] text-center">
                                      <div>
                                        <div className="text-[10px] font-semibold text-brand-green uppercase tracking-wider">Utuh</div>
                                        <div className="text-xs font-extrabold text-[#1a1814] mt-0.5">{item.utuh}</div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider">Pecah</div>
                                        <div className="text-xs font-extrabold text-rose-600 mt-0.5">{item.pecah}</div>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Sortir</div>
                                        <div className="text-xs font-extrabold text-amber-600 mt-0.5">{item.sortir}</div>
                                      </div>
                                      <div className="bg-[#e8f0e6]/40 rounded-lg py-0.5 border border-brand-green/10">
                                        <div className="text-[10px] font-semibold text-brand-green uppercase tracking-wider">Total</div>
                                        <div className="text-xs font-black text-brand-green mt-0.5">{item.total}</div>
                                      </div>
                                    </div>

                                    {/* Actions footer */}
                                    <div className="flex items-center justify-between pt-2 border-t border-[#faf9f6]">
                                      <div className="text-[10px] text-[#6b6560] font-medium flex items-center gap-1 bg-[#faf9f7] px-2 py-1 rounded-md border border-[#e8e4de]/60 max-w-[50%] truncate" title={item.createdBy || "Sistem"}>
                                        <UserCheck className="w-3 h-3 text-[#9e9892]" />
                                        <span className="truncate">Oleh: {item.createdBy?.split("@")[0] || "Sistem"}</span>
                                      </div>
                                      {!isGuest && (
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            onClick={() => handleOpenEditForm(item)}
                                            disabled={isSelectedDateLocked && !isMasterAdmin}
                                            className={`px-2.5 py-1.5 border rounded-lg transition-all text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                                              isSelectedDateLocked && !isMasterAdmin
                                                ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                                                : "border-[#e8e4de] bg-white hover:border-brand-green hover:bg-brand-green-light text-[#6b6560] hover:text-brand-green"
                                            }`}
                                          >
                                            <Edit2 className="w-3 h-3" />
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => handleDeleteEntry(item.id)}
                                            disabled={isSelectedDateLocked && !isMasterAdmin}
                                            className={`px-2.5 py-1.5 border rounded-lg transition-all text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                                              isSelectedDateLocked && !isMasterAdmin
                                                ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                                                : "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700"
                                            }`}
                                          >
                                            <Trash2 className="w-3 h-3" />
                                            Hapus
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </motion.div>
                )}

                {/* VIEWPORT: USER MANAGEMENT */}
                {activeTab === "users" && isMasterAdmin && (
                  <motion.div
                    key="users"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.2 }}
                    className="grid grid-cols-1 md:grid-cols-3 gap-6"
                  >
                    {/* Authorize New Email Form */}
                    <div className="bg-white border-2 border-[#e8e4de] rounded-3xl p-6 shadow-xs h-fit">
                      <div className="flex items-center gap-2 mb-4">
                        <Users className="w-5 h-5 text-brand-green" />
                        <h2 className="text-base font-extrabold text-[#1a1814]">Tambah Akun & Otorisasi</h2>
                      </div>
                      <p className="text-xs text-[#6b6560] leading-relaxed mb-4">
                        Tambahkan pengguna baru di bawah ini. Jika Anda mengisi kolom <strong>Password</strong>, akun Firebase Authentication pengguna tersebut juga akan dibuat secara otomatis.
                      </p>

                      {userActionError && (
                        <div className="bg-rose-50 border border-rose-100 text-rose-800 p-3 rounded-xl flex items-start gap-2.5 text-xs font-semibold mb-4">
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                          <span>{userActionError}</span>
                        </div>
                      )}

                      <form onSubmit={handleAddAllowedUser} className="space-y-4">
                        <div>
                          <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1">
                            Alamat Email Pengguna
                          </label>
                          <input
                            type="email"
                            required
                            disabled={isCreatingAccount}
                            placeholder="nama@email.com"
                            value={newAllowedEmail}
                            onChange={(e) => setNewAllowedEmail(e.target.value)}
                            className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1">
                            Password Baru (Opsional)
                          </label>
                          <input
                            type="password"
                            disabled={isCreatingAccount}
                            placeholder="Minimal 6 karakter"
                            value={newAllowedPassword}
                            onChange={(e) => setNewAllowedPassword(e.target.value)}
                            className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors disabled:opacity-50"
                          />
                          <p className="text-[10px] text-[#9e9892] mt-1 leading-normal">
                            Kosongkan jika hanya ingin mengizinkan email yang sudah terdaftar sebelumnya.
                          </p>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1">
                            Badge Pabrik (Opsional)
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { key: 'pbr1', label: '🏭 PBR 1', active: 'border-indigo-400 bg-indigo-50 text-indigo-700', hover: 'hover:border-indigo-300' },
                              { key: 'pbr2', label: '🏭 PBR 2', active: 'border-teal-400 bg-teal-50 text-teal-700', hover: 'hover:border-teal-300' },
                              { key: 'ppg', label: '🏭 PPG', active: 'border-amber-400 bg-amber-50 text-amber-700', hover: 'hover:border-amber-300' },
                              { key: 'ppj', label: '🏭 PPJ', active: 'border-rose-400 bg-rose-50 text-rose-700', hover: 'hover:border-rose-300' },
                              { key: 'all', label: '🏭 Semua Pabrik', active: 'border-violet-400 bg-violet-50 text-violet-700', hover: 'hover:border-violet-300' },
                            ].map(opt => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => setNewPabrikRole(newPabrikRole === opt.key ? "" : opt.key as any)}
                                className={`px-2 py-2 rounded-xl text-[11px] font-bold border-2 transition-all cursor-pointer ${
                                  newPabrikRole === opt.key
                                    ? opt.active + " shadow-sm"
                                    : "border-[#e8e4de] bg-[#faf9f7] text-[#6b6560] " + opt.hover
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] text-[#9e9892] mt-1 leading-normal">
                            Tentukan pabrik yang dikelola user. Kosongkan jika tidak perlu pembatasan.
                          </p>
                        </div>

                        <button
                          type="submit"
                          disabled={isCreatingAccount}
                          className="w-full bg-brand-green hover:bg-brand-green-hover text-white py-2.5 px-4 rounded-xl font-bold text-xs tracking-wide shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-75 cursor-pointer disabled:cursor-not-allowed"
                        >
                          {isCreatingAccount ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Memproses...
                            </>
                          ) : (
                            <>
                              ➕ {newAllowedPassword ? "Buat Akun & Izinkan" : "Berikan Izin Akses"}
                            </>
                          )}
                        </button>
                      </form>
                    </div>

                    {/* Authorized Users List Table */}
                    <div className="bg-white border-2 border-[#e8e4de] rounded-3xl p-6 shadow-xs md:col-span-2">
                      <div className="flex items-center justify-between gap-4 mb-4">
                        <h2 className="text-base font-extrabold text-[#1a1814]">Daftar Email Diizinkan</h2>
                        <span className="text-xs bg-brand-green-light text-brand-green font-bold px-2 py-0.5 rounded-full">
                          {allowedUsers.filter(u => u.role !== 'guest' && !u.email.startsWith('guest_')).length} Terdaftar
                        </span>
                      </div>

                      {/* Desktop Table View (hidden on mobile) */}
                      <div className="hidden md:block border border-[#e8e4de] rounded-2xl overflow-hidden">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[#faf9f7] border-b border-[#e8e4de] text-[#6b6560] font-semibold uppercase text-[10px] tracking-wider">
                              <th className="py-2.5 px-4">Alamat Email</th>
                              <th className="py-2.5 px-4">Role</th>
                              <th className="py-2.5 px-4">Ditambahkan Pada</th>
                              <th className="py-2.5 px-4 text-center w-24">Aksi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e8e4de]">
                            {allowedUsers.filter(u => u.role !== 'guest' && !u.email.startsWith('guest_')).map((usr) => (
                              <tr key={usr.email} className="hover:bg-[#faf9f7]/50 transition-colors">
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-[#1a1814]">{usr.email}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  {usr.email.toLowerCase() === "managementpackaging@gmail.com" && (
                                    <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                      Admin Utama
                                    </span>
                                  )}
                                  {usr.role === "admin" && usr.email.toLowerCase() !== "managementpackaging@gmail.com" && (
                                    <span className="bg-sky-100 text-sky-800 text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                      Admin
                                    </span>
                                  )}
                                  {usr.pabrikRole && PABRIK_ROLE_MAP[usr.pabrikRole] && (
                                    <span className={`${PABRIK_ROLE_MAP[usr.pabrikRole].bgColor} ${PABRIK_ROLE_MAP[usr.pabrikRole].color} text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider border ${PABRIK_ROLE_MAP[usr.pabrikRole].borderColor}`}>
                                      {PABRIK_ROLE_MAP[usr.pabrikRole].label}
                                    </span>
                                  )}

                                </td>
                                <td className="py-3 px-4 text-[#9e9892] font-semibold text-[11px]">
                                  {usr.addedAt ? new Date(usr.addedAt).toLocaleString("id-ID") : "-"}
                                </td>
                                <td className="py-3 px-4 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {editingUserBadge === usr.email ? (
                                      <div className="flex items-center gap-1">
                                        <select
                                          value={editingBadgeValue}
                                          onChange={(e) => setEditingBadgeValue(e.target.value as any)}
                                          className="text-[10px] px-1 py-0.5 border border-[#e8e4de] rounded-md bg-white font-bold"
                                        >
                                          <option value="">Tanpa Badge</option>
                                          <option value="pbr1">PBR 1</option>
                                          <option value="pbr2">PBR 2</option>
                                          <option value="ppg">PPG</option>
                                          <option value="ppj">PPJ</option>
                                          <option value="all">Semua</option>
                                        </select>
                                        <button onClick={() => handleSaveUserBadge(usr.email)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-md cursor-pointer" title="Simpan">
                                          <CheckCircle className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => setEditingUserBadge(null)} className="p-1 text-[#9e9892] hover:bg-slate-100 rounded-md cursor-pointer" title="Batal">
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => { setEditingUserBadge(usr.email); setEditingBadgeValue(usr.pabrikRole || ""); }}
                                          className="p-1.5 rounded-lg border border-[#e8e4de] hover:border-sky-200 hover:bg-sky-50 text-[#6b6560] hover:text-sky-600 transition-all cursor-pointer"
                                          title="Edit Badge Pabrik"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleRemoveAllowedUser(usr.email)}
                                          disabled={usr.email.toLowerCase() === "managementpackaging@gmail.com"}
                                          className={`p-1.5 rounded-lg border transition-all ${
                                            usr.email.toLowerCase() === "managementpackaging@gmail.com"
                                              ? "text-[#c4bfb7] border-[#e8e4de] cursor-not-allowed"
                                              : "border-[#e8e4de] hover:border-rose-200 hover:bg-rose-50 text-[#6b6560] hover:text-rose-600"
                                          }`}
                                          title="Cabut Izin Akses"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Card List View (shown on mobile) */}
                      <div className="block md:hidden space-y-3">
                        {allowedUsers.filter(u => u.role !== 'guest' && !u.email.startsWith('guest_')).map((usr) => (
                          <div key={usr.email} className="bg-[#faf9f7] border-2 border-[#e8e4de] rounded-2xl p-4 flex flex-col gap-2 relative overflow-hidden">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-xs text-[#1a1814] break-all">{usr.email}</span>
                                  {usr.email.toLowerCase() === "managementpackaging@gmail.com" && (
                                    <span className="bg-amber-100 text-amber-800 text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                      Admin Utama
                                    </span>
                                  )}
                                  {usr.role === "admin" && usr.email.toLowerCase() !== "managementpackaging@gmail.com" && (
                                    <span className="bg-sky-100 text-sky-800 text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                      Admin
                                    </span>
                                  )}
                                  {usr.pabrikRole && PABRIK_ROLE_MAP[usr.pabrikRole] && (
                                    <span className={`${PABRIK_ROLE_MAP[usr.pabrikRole].bgColor} ${PABRIK_ROLE_MAP[usr.pabrikRole].color} text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider border ${PABRIK_ROLE_MAP[usr.pabrikRole].borderColor}`}>
                                      {PABRIK_ROLE_MAP[usr.pabrikRole].label}
                                    </span>
                                  )}

                                </div>
                                <div className="text-[10px] text-[#9e9892] font-medium">
                                  Sejak: {usr.addedAt ? new Date(usr.addedAt).toLocaleString("id-ID") : "-"}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {editingUserBadge === usr.email ? (
                                  <div className="flex items-center gap-1">
                                    <select
                                      value={editingBadgeValue}
                                      onChange={(e) => setEditingBadgeValue(e.target.value as any)}
                                      className="text-[10px] px-1 py-0.5 border border-[#e8e4de] rounded-md bg-white font-bold"
                                    >
                                      <option value="">Tanpa Badge</option>
                                      <option value="pbr1">PBR 1</option>
                                      <option value="pbr2">PBR 2</option>
                                      <option value="ppg">PPG</option>
                                      <option value="ppj">PPJ</option>
                                      <option value="all">Semua</option>
                                    </select>
                                    <button onClick={() => handleSaveUserBadge(usr.email)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer" title="Simpan">
                                      <CheckCircle className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setEditingUserBadge(null)} className="p-1.5 text-[#9e9892] hover:bg-slate-100 rounded-lg cursor-pointer" title="Batal">
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => { setEditingUserBadge(usr.email); setEditingBadgeValue(usr.pabrikRole || ""); }}
                                      className="p-2.5 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-600 transition-all cursor-pointer"
                                      title="Edit Badge Pabrik"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleRemoveAllowedUser(usr.email)}
                                      disabled={usr.email.toLowerCase() === "managementpackaging@gmail.com"}
                                      className={`p-2.5 rounded-xl border transition-all ${
                                        usr.email.toLowerCase() === "managementpackaging@gmail.com"
                                          ? "text-[#c4bfb7] border-slate-200 cursor-not-allowed bg-slate-50"
                                          : "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600"
                                      }`}
                                      title="Cabut Izin Akses"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Master Data Management Section */}
                    <div className="md:col-span-3 space-y-4">
                      <div className="flex items-center gap-2 pt-2">
                        <div className="h-[2px] flex-1 bg-[#e8e4de]" />
                        <h2 className="text-xs font-extrabold text-[#6b6560] uppercase tracking-widest">Master Data</h2>
                        <div className="h-[2px] flex-1 bg-[#e8e4de]" />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Vendors Card */}
                        <div className="bg-white border-2 border-[#e8e4de] rounded-2xl p-5 shadow-xs">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-base">🏷️</span>
                            <h3 className="text-sm font-extrabold text-[#1a1814]">Vendor</h3>
                            <span className="ml-auto text-[10px] bg-brand-green-light text-brand-green font-bold px-1.5 py-0.5 rounded-full">{effectiveVendors.length}</span>
                          </div>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleAddMasterData("vendors", newVendor, setNewVendor, "Vendor");
                            }}
                            className="flex gap-2 mb-3"
                          >
                            <input
                              type="text"
                              placeholder="Nama vendor baru"
                              value={newVendor}
                              onChange={(e) => setNewVendor(e.target.value)}
                              className="flex-1 px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                            />
                            <button
                              type="submit"
                              className="bg-brand-green hover:bg-brand-green-hover text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </form>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {effectiveVendors.map((v) => {
                              const docId = v.toLowerCase().replace(/[^a-z0-9]/g, '_');
                              const isEditing = editingMasterData?.collection === "vendors" && editingMasterData?.docId === docId;
                              return (
                                <div key={v} className={`flex items-center justify-between gap-2 border rounded-lg px-3 py-1.5 ${isEditing ? "bg-brand-green-light/30 border-brand-green/30" : "bg-[#faf9f7] border-[#e8e4de]"}`}>
                                  {isEditing ? (
                                    <>
                                      <input
                                        type="text"
                                        value={editingMasterData.editedName}
                                        onChange={(e) => setEditingMasterData({ ...editingMasterData, editedName: e.target.value })}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveEditMasterData(); if (e.key === "Escape") handleCancelEditMasterData(); }}
                                        className="flex-1 px-2 py-1 bg-white border border-brand-green rounded-md text-xs font-bold focus:outline-none"
                                        autoFocus
                                      />
                                      <button onClick={handleSaveEditMasterData} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-md transition-all cursor-pointer" title="Simpan">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={handleCancelEditMasterData} className="p-1 text-[#9e9892] hover:bg-slate-100 rounded-md transition-all cursor-pointer" title="Batal">
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-xs font-bold text-[#1a1814] flex-1">{v}</span>
                                      <button
                                        onClick={() => handleEditMasterData("vendors", docId, v)}
                                        className="p-1 text-[#9e9892] hover:text-sky-600 hover:bg-sky-50 rounded-md transition-all cursor-pointer"
                                        title="Edit"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteMasterData("vendors", docId, "Vendor", v)}
                                        className="p-1 text-[#9e9892] hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer"
                                        title="Hapus"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Jenis Kantong Card */}
                        <div className="bg-white border-2 border-[#e8e4de] rounded-2xl p-5 shadow-xs">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-base">👝</span>
                            <h3 className="text-sm font-extrabold text-[#1a1814]">Jenis Kantong</h3>
                            <span className="ml-auto text-[10px] bg-brand-green-light text-brand-green font-bold px-1.5 py-0.5 rounded-full">{effectiveJenisKantong.length}</span>
                          </div>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleAddMasterData("jenis_kantong", newJenisKantong, setNewJenisKantong, "Jenis Kantong");
                            }}
                            className="flex gap-2 mb-3"
                          >
                            <input
                              type="text"
                              placeholder="Nama jenis kantong baru"
                              value={newJenisKantong}
                              onChange={(e) => setNewJenisKantong(e.target.value)}
                              className="flex-1 px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                            />
                            <button
                              type="submit"
                              className="bg-brand-green hover:bg-brand-green-hover text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </form>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {effectiveJenisKantong.map((jk) => {
                              const docId = jk.toLowerCase().replace(/[^a-z0-9]/g, '_');
                              const isEditing = editingMasterData?.collection === "jenis_kantong" && editingMasterData?.docId === docId;
                              return (
                                <div key={jk} className={`flex items-center justify-between gap-2 border rounded-lg px-3 py-1.5 ${isEditing ? "bg-brand-green-light/30 border-brand-green/30" : "bg-[#faf9f7] border-[#e8e4de]"}`}>
                                  {isEditing ? (
                                    <>
                                      <input
                                        type="text"
                                        value={editingMasterData.editedName}
                                        onChange={(e) => setEditingMasterData({ ...editingMasterData, editedName: e.target.value })}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveEditMasterData(); if (e.key === "Escape") handleCancelEditMasterData(); }}
                                        className="flex-1 px-2 py-1 bg-white border border-brand-green rounded-md text-xs font-bold focus:outline-none"
                                        autoFocus
                                      />
                                      <button onClick={handleSaveEditMasterData} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-md transition-all cursor-pointer" title="Simpan">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={handleCancelEditMasterData} className="p-1 text-[#9e9892] hover:bg-slate-100 rounded-md transition-all cursor-pointer" title="Batal">
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-xs font-bold text-[#1a1814] truncate flex-1">{jk}</span>
                                      <button
                                        onClick={() => handleEditMasterData("jenis_kantong", docId, jk)}
                                        className="p-1 text-[#9e9892] hover:text-sky-600 hover:bg-sky-50 rounded-md transition-all cursor-pointer"
                                        title="Edit"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteMasterData("jenis_kantong", docId, "Jenis Kantong", jk)}
                                        className="p-1 text-[#9e9892] hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer"
                                        title="Hapus"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Pabrik Card */}
                        <div className="bg-white border-2 border-[#e8e4de] rounded-2xl p-5 shadow-xs">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-base">🏭</span>
                            <h3 className="text-sm font-extrabold text-[#1a1814]">Pabrik</h3>
                            <span className="ml-auto text-[10px] bg-brand-green-light text-brand-green font-bold px-1.5 py-0.5 rounded-full">{effectivePabrikList.length}</span>
                          </div>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleAddMasterData("pabrik_list", newPabrik, setNewPabrik, "Pabrik");
                            }}
                            className="flex gap-2 mb-3"
                          >
                            <input
                              type="text"
                              placeholder="Nama pabrik baru"
                              value={newPabrik}
                              onChange={(e) => setNewPabrik(e.target.value)}
                              className="flex-1 px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                            />
                            <button
                              type="submit"
                              className="bg-brand-green hover:bg-brand-green-hover text-white px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </form>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {effectivePabrikList.map((pb) => {
                              const docId = pb.toLowerCase().replace(/[^a-z0-9]/g, '_');
                              const isEditing = editingMasterData?.collection === "pabrik_list" && editingMasterData?.docId === docId;
                              return (
                                <div key={pb} className={`flex items-center justify-between gap-2 border rounded-lg px-3 py-1.5 ${isEditing ? "bg-brand-green-light/30 border-brand-green/30" : "bg-[#faf9f7] border-[#e8e4de]"}`}>
                                  {isEditing ? (
                                    <>
                                      <input
                                        type="text"
                                        value={editingMasterData.editedName}
                                        onChange={(e) => setEditingMasterData({ ...editingMasterData, editedName: e.target.value })}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveEditMasterData(); if (e.key === "Escape") handleCancelEditMasterData(); }}
                                        className="flex-1 px-2 py-1 bg-white border border-brand-green rounded-md text-xs font-bold focus:outline-none"
                                        autoFocus
                                      />
                                      <button onClick={handleSaveEditMasterData} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-md transition-all cursor-pointer" title="Simpan">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={handleCancelEditMasterData} className="p-1 text-[#9e9892] hover:bg-slate-100 rounded-md transition-all cursor-pointer" title="Batal">
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-xs font-bold text-[#1a1814] truncate flex-1">{pb}</span>
                                      <button
                                        onClick={() => handleEditMasterData("pabrik_list", docId, pb)}
                                        className="p-1 text-[#9e9892] hover:text-sky-600 hover:bg-sky-50 rounded-md transition-all cursor-pointer"
                                        title="Edit"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteMasterData("pabrik_list", docId, "Pabrik", pb)}
                                        className="p-1 text-[#9e9892] hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer"
                                        title="Hapus"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </main>

            {/* Mobile Bottom Navigation Bar (hidden on desktop) */}
            <div className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-[#e8e4de] py-2 px-4 flex justify-around gap-1 z-30 shadow-lg">
              <button
                onClick={() => setActiveTab("dash")}
                className={`flex-1 flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition-all ${
                  activeTab === "dash" ? "text-brand-green bg-brand-green-light/60 font-bold" : "text-[#9e9892]"
                }`}
              >
                <BarChart3 className="w-5 h-5" />
                <span className="text-[11px]">Dashboard</span>
              </button>

              {!isGuest && (
                <button
                  onClick={() => setActiveTab("input")}
                  className={`flex-1 flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition-all ${
                    activeTab === "input" ? "text-brand-green bg-brand-green-light/60 font-bold" : "text-[#9e9892]"
                  }`}
                >
                  <FileText className="w-5 h-5" />
                  <span className="text-[11px]">Pelaporan</span>
                </button>
              )}

              {isMasterAdmin && (
                <button
                  onClick={() => setActiveTab("users")}
                  className={`flex-1 flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition-all ${
                    activeTab === "users" ? "text-brand-green bg-brand-green-light/60 font-bold" : "text-[#9e9892]"
                  }`}
                >
                  <Users className="w-5 h-5" />
                  <span className="text-[11px]">Users</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* FORM INPUT MODAL */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            {/* Backdrop animation */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-[#1a1814]/40 backdrop-blur-sm"
            />

            {/* Modal Body */}
            <motion.div
              initial={{ y: 200, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 200, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="bg-white border-2 border-[#e8e4de] rounded-t-3xl sm:rounded-3xl shadow-xl w-full max-w-xl relative overflow-hidden z-10 max-h-[90vh] flex flex-col"
            >
              <div className="p-4 md:p-5 border-b border-[#e8e4de] flex items-center justify-between bg-[#fcfbfa]">
                <h3 className="font-extrabold text-sm md:text-base text-[#1a1814]">
                  {editingId ? "✏️ Edit Laporan Pemakaian" : "➕ Tambah Laporan Baru"}
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 text-[#6b6560] hover:text-[#1a1814] hover:bg-[#faf9f7] rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveEntry} className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Vendor Selection */}
                  <div>
                    <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1.5">
                      Tanggal
                    </label>
                    <input
                      type="date"
                      value={formTanggal}
                      onChange={(e) => setFormTanggal(e.target.value)}
                      className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1.5">
                      Vendor
                    </label>
                    <select
                      value={formVendor}
                      onChange={(e) => setFormVendor(e.target.value)}
                      className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white"
                    >
                      {effectiveVendors.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Jenis Kantong Selection */}
                  <div>
                    <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1.5">
                      Jenis Kantong
                    </label>
                    <select
                      value={formJenis}
                      onChange={(e) => setFormJenis(e.target.value)}
                      className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white"
                    >
                      {effectiveJenisKantong.map((jk) => (
                        <option key={jk} value={jk}>
                          {jk}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Pabrik Selection */}
                  <div>
                    <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1.5">
                      Pabrik
                      {userPabrikRole && (
                        <span className="ml-1.5 text-[9px] text-indigo-600 font-bold">(Sesuai Badge)</span>
                      )}
                    </label>
                    <select
                      value={formPabrik}
                      onChange={(e) => setFormPabrik(e.target.value)}
                      disabled={!!userPabrikRole && userAllowedPabrik.length <= 1}
                      className={`w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white ${!!userPabrikRole && userAllowedPabrik.length <= 1 ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      {userAllowedPabrik.map((pb) => (
                        <option key={pb} value={pb}>
                          {pb}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Shift Selection */}
                  <div>
                    <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1.5">
                      Shift Kerja
                    </label>
                    <select
                      value={formShift}
                      onChange={(e) => setFormShift(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white"
                    >
                      <option value={1}>Shift 1 (00:00 – 08:00)</option>
                      <option value={2}>Shift 2 (08:00 – 16:00)</option>
                      <option value={3}>Shift 3 (16:00 – 24:00)</option>
                    </select>
                  </div>
                </div>

                <div className="border-t border-[#e8e4de] pt-5">
                  <h4 className="text-xs font-extrabold text-[#1a1814] tracking-wide uppercase mb-3">Jumlah Pemakaian Kantong</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {/* Intact bag count */}
                    <div>
                      <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1">
                        Utuh (Pcs)
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formUtuh}
                        onChange={(e) => setFormUtuh(e.target.value)}
                        className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white"
                      />
                    </div>

                    {/* Broken bag count */}
                    <div>
                      <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1">
                        Pecah (Pcs)
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formPecah}
                        onChange={(e) => setFormPecah(e.target.value)}
                        className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white text-rose-600"
                      />
                    </div>

                    {/* Sorted bag count */}
                    <div>
                      <label className="block text-[10px] font-bold text-[#6b6560] uppercase tracking-wider mb-1">
                        Sortir (Pcs)
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formSortir}
                        onChange={(e) => setFormSortir(e.target.value)}
                        className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white text-amber-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-[#e8e4de] flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="border-2 border-[#e8e4de] hover:bg-[#faf9f7] text-[#1a1814] px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="bg-brand-green hover:bg-brand-green-hover text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-xs transition-colors"
                  >
                    {editingId ? "Simpan Perubahan" : "Simpan Laporan"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CUSTOM CONFIRMATION MODAL */}
      <AnimatePresence>
        {confirmModal?.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(null)}
              className="absolute inset-0 bg-[#1a1814]/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 50, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="bg-white border-2 border-[#e8e4de] rounded-2xl shadow-xl w-full max-w-sm relative overflow-hidden z-10 p-5 flex flex-col gap-4"
            >
              <div>
                <h4 className="font-extrabold text-[#1a1814] text-base mb-1">
                  {confirmModal.title}
                </h4>
                <p className="text-xs text-[#6b6560] leading-relaxed">
                  {confirmModal.message}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 bg-[#faf9f7] hover:bg-[#faf9f7]/80 text-[#6b6560] border border-[#e8e4de] rounded-xl text-xs font-bold transition-all"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const cb = confirmModal.onConfirm;
                    setConfirmModal(null);
                    await cb();
                  }}
                  className="px-4 py-2 bg-brand-green hover:bg-brand-green-hover text-white rounded-xl text-xs font-bold shadow-xs transition-all"
                >
                  Ya, Lanjutkan
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
