import React, { useState, useEffect } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  serverTimestamp,
  writeBatch
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
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  LogIn,
  UserPlus,
  Lock,
  Mail,
  UserCheck,
  X
} from "lucide-react";
import { auth, db, firebaseConfig } from "./firebase";
import { LaporanKantong, AllowedUser } from "./types";
import { getDateString } from "./utils";
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

const VENDORS = ["GEMAH", "YANA", "HARDO", "IKSG", "KRR", "SAMI"];
const JENIS_KANTONG = [
  "Semen Baturaja (SMBR)",
  "Semen DYNAMIX (DYX)",
  "Semen MERDEKA (MDK)",
  "Semen PADANG (PDG)",
  "BIGBAG OPC",
  "BIGBAG PCC",
  "MACAN"
];
const JENIS_KANTONG_SHORT = ["SMBR", "DYX", "MDK", "PDG", "BIGBAG OPC", "BIGBAG PCC", "MACAN"];
const PABRIK_LIST = ["Pabrik Baturaja 1 (PBR 1)", "Pabrik Baturaja 2 (PBR 2)"];
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
  const [isSignUp, setIsSignUp] = useState<boolean>(false);

  // Form inputs for Auth
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // App data state (real-time synchronized from Firestore)
  const [reports, setReports] = useState<LaporanKantong[]>([]);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUser[]>([]);
  const [dataLoading, setDataLoading] = useState<boolean>(true);

  // Active page state
  const [activeTab, setActiveTab] = useState<"dash" | "input" | "users">("dash");

  // Selected date state
  const [selectedDate, setSelectedDate] = useState<string>(getDateString(new Date()));

  useEffect(() => {
    setSelectedDate(getDateString(new Date()));
  }, []);

  // Toast notification state
  const [toasts, setToasts] = useState<{ id: string; text: string; type: "ok" | "er" | "inf" }[]>([]);
  const [logoErrorLogin, setLogoErrorLogin] = useState(false);
  const [logoErrorHeader, setLogoErrorHeader] = useState(false);

  // Modal form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formVendor, setFormVendor] = useState(VENDORS[0]);
  const [formJenis, setFormJenis] = useState(JENIS_KANTONG[0]);
  const [formPabrik, setFormPabrik] = useState(PABRIK_LIST[0]);
  const [formShift, setFormShift] = useState(1);
  const [formUtuh, setFormUtuh] = useState("");
  const [formPecah, setFormPecah] = useState("");
  const [formSortir, setFormSortir] = useState("");

  // User management state
  const [newAllowedEmail, setNewAllowedEmail] = useState("");
  const [newAllowedPassword, setNewAllowedPassword] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [userActionError, setUserActionError] = useState("");

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
        const userEmail = user.email ? user.email.toLowerCase() : "";

        // Admin bootstrapping check: automatically authorize managementpackaging@gmail.com
        if (userEmail === "managementpackaging@gmail.com") {
          setIsAllowed(true);
          try {
            const userDocRef = doc(db, "allowed_users", userEmail);
            const docSnap = await getDoc(userDocRef);
            if (!docSnap.exists() || !docSnap.data()?.allowed) {
              await setDoc(userDocRef, {
                email: userEmail,
                allowed: true,
                addedAt: new Date().toISOString()
              });
              triggerToast("Admin account bootstrapped successfully", "ok");
            }
          } catch (e) {
            console.error("Autobootstrap failed:", e);
            handleFirestoreError(e, OperationType.WRITE, `allowed_users/${userEmail}`);
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
    if (!currentUser || isAllowed !== true) {
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

  // Prevent unauthorized access to "users" tab
  useEffect(() => {
    if (activeTab === "users" && currentUser?.email?.toLowerCase() !== "managementpackaging@gmail.com") {
      setActiveTab("dash");
    }
  }, [activeTab, currentUser]);

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
      if (isSignUp) {
        // Sign Up
        await createUserWithEmailAndPassword(auth, email.trim(), password);
        triggerToast("Pendaftaran berhasil!", "ok");
      } else {
        // Sign In
        await signInWithEmailAndPassword(auth, email.trim(), password);
        triggerToast("Berhasil masuk!", "ok");
      }
    } catch (err: any) {
      console.error("Auth Error:", err);
      let errorMsg = "Terjadi kesalahan. Silakan coba lagi.";
      if (err.code === "auth/email-already-in-use") {
        errorMsg = "Email ini sudah terdaftar.";
      } else if (err.code === "auth/invalid-email") {
        errorMsg = "Format email tidak valid.";
      } else if (err.code === "auth/weak-password") {
        errorMsg = "Password minimal harus 6 karakter.";
      } else if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        errorMsg = "Email atau password salah.";
      } else if (err.code === "auth/operation-not-allowed") {
        errorMsg = "Metode masuk Email/Password belum diaktifkan di Firebase Console Anda. Silakan aktifkan terlebih dahulu agar pengguna dapat mendaftar dan masuk.";
      }
      setAuthError(errorMsg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
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
        await createUserWithEmailAndPassword(secondaryAuth, targetEmail, targetPassword);
      }

      const userDocRef = doc(db, "allowed_users", targetEmail);
      await setDoc(userDocRef, {
        email: targetEmail,
        allowed: true,
        addedAt: new Date().toISOString()
      });

      setNewAllowedEmail("");
      setNewAllowedPassword("");
      
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
    if (!window.confirm(`Apakah Anda yakin ingin mencabut izin akses untuk ${targetEmail}?`)) {
      return;
    }

    try {
      const userDocRef = doc(db, "allowed_users", targetEmail.toLowerCase());
      await deleteDoc(userDocRef);
      triggerToast(`Berhasil menghapus izin untuk ${targetEmail}`, "ok");
    } catch (err) {
      console.error("Remove user failed:", err);
      triggerToast("Gagal menghapus izin akses", "er");
      handleFirestoreError(err, OperationType.DELETE, `allowed_users/${targetEmail}`);
    }
  };

  // Manage Report Records
  const handleOpenAddForm = () => {
    setEditingId(null);
    setFormVendor(VENDORS[0]);
    setFormJenis(JENIS_KANTONG[0]);
    setFormPabrik(PABRIK_LIST[0]);
    const currentHour = new Date().getHours();
    setFormShift(currentHour < 8 ? 1 : currentHour < 16 ? 2 : 3);
    setFormUtuh("");
    setFormPecah("");
    setFormSortir("");
    setIsModalOpen(true);
  };

  const handleOpenEditForm = (item: LaporanKantong) => {
    setEditingId(item.id);
    setFormVendor(item.vendor);
    setFormJenis(item.nama);
    setFormPabrik(item.pabrik);
    setFormShift(item.shift);
    setFormUtuh(item.utuh.toString());
    setFormPecah(item.pecah.toString());
    setFormSortir(item.sortir.toString());
    setIsModalOpen(true);
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const utuhNum = Number(formUtuh) || 0;
    const pecahNum = Number(formPecah) || 0;
    const sortirNum = Number(formSortir) || 0;
    const totalNum = utuhNum + pecahNum + sortirNum;

    if (utuhNum === 0 && pecahNum === 0 && sortirNum === 0) {
      triggerToast("Minimal isi satu jumlah (Utuh, Pecah, atau Sortir)", "er");
      return;
    }

    const docId = editingId || `report_${Date.now()}`;
    const entryData = {
      id: docId,
      vendor: formVendor,
      nama: formJenis,
      pabrik: formPabrik,
      shift: Number(formShift),
      tanggal: selectedDate,
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
    if (!window.confirm("Apakah Anda yakin ingin menghapus baris laporan ini?")) {
      return;
    }

    try {
      await deleteDoc(doc(db, "laporan_kantong", id));
      triggerToast("Laporan berhasil dihapus", "ok");
    } catch (err) {
      console.error("Delete entry failed:", err);
      triggerToast("Gagal menghapus laporan", "er");
      handleFirestoreError(err, OperationType.DELETE, `laporan_kantong/${id}`);
    }
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

  // CSV Export function
  const handleExportCSV = () => {
    if (filteredReports.length === 0) {
      triggerToast("Tidak ada data untuk diekspor pada tanggal ini", "er");
      return;
    }

    const header = "No,Tanggal,Vendor,Jenis Kantong,Pabrik,Shift,Utuh,Pecah,Sortir,Total,Dilaporkan Oleh";
    const rows = filteredReports.map((r, index) => {
      return `${index + 1},${r.tanggal},"${r.vendor}","${r.nama}","${r.pabrik}",Shift ${r.shift},${r.utuh},${r.pecah},${r.sortir},${r.total},"${r.createdBy}"`;
    });

    const csvContent = "\uFEFF" + header + "\n" + rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Laporan_Pemakaian_Kantong_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast("File CSV berhasil diunduh", "ok");
  };

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#1a1814] flex flex-col selection:bg-brand-green selection:text-white">
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
                <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight text-[#1a1814] mb-1 whitespace-nowrap">
                  PACKAGING <span className="text-brand-green">MANAGEMENT</span>
                </h1>
                <p className="text-xs font-bold text-brand-green tracking-wide mb-3">
                  Laporan Pemakaian Kantong
                </p>
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
                  {authError.includes("belum diaktifkan") && (
                    <div className="mt-2 pt-2 border-t border-rose-200/50 flex flex-col gap-2 font-normal text-rose-900 leading-relaxed text-left">
                      <p className="font-bold">Cara Mengaktifkan di Firebase Console:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Buka halaman autentikasi proyek Firebase Anda.</li>
                        <li>Pilih tab <strong>Sign-in method</strong>.</li>
                        <li>Klik tombol <strong>Add new provider</strong> dan pilih <strong>Email/Password</strong>.</li>
                        <li>Aktifkan opsi pertama (Email/password) lalu klik <strong>Save</strong>.</li>
                      </ol>
                      <a
                        href="https://console.firebase.google.com/project/gen-lang-client-0065314458/authentication/providers"
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
                  className="w-full bg-brand-green hover:bg-brand-green-hover text-white py-3.5 px-6 rounded-xl font-bold text-sm tracking-wide shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4.5 h-4.5" />
                  Masuk Ke Aplikasi
                </button>
              </form>
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
              <div className="max-w-7xl mx-auto px-4 md:px-6 h-18 flex items-center justify-between gap-4">
                {/* Brand Logo & Name */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white border border-[#e8e4de] flex items-center justify-center p-0.5 shadow-sm overflow-hidden shrink-0">
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
                  <div className="min-w-0">
                    <h1 className="text-sm sm:text-base font-extrabold leading-tight tracking-tight text-[#1a1814] truncate">
                      Laporan <span className="text-brand-green">Pemakaian Kantong</span>
                    </h1>
                    <div className="text-[10px] text-[#9e9892] font-semibold flex items-center gap-1 truncate">
                      <UserCheck className="w-3 h-3 text-emerald-600" />
                      <span className="truncate">{currentUser.email}</span>
                      <span className="text-[#c4bfb7] shrink-0">•</span>
                      <span className="text-emerald-700 bg-emerald-50 px-1 rounded-sm text-[9px] uppercase font-bold tracking-wider shrink-0">Authorized</span>
                    </div>
                  </div>
                </div>

                {/* Navigation and Date filter controls */}
                <div className="flex items-center gap-2">
                  {/* Desktop navigation tabs */}
                  <div className="hidden md:flex items-center gap-1 mr-4 border-r border-[#e8e4de] pr-4">
                    <button
                      onClick={() => setActiveTab("dash")}
                      className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all ${
                        activeTab === "dash"
                          ? "bg-brand-green text-white shadow-sm"
                          : "text-[#6b6560] hover:bg-[#faf9f6] hover:text-[#1a1814]"
                      }`}
                    >
                      <BarChart3 className="w-4.5 h-4.5" />
                      Dashboard
                    </button>
                    <button
                      onClick={() => setActiveTab("input")}
                      className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all ${
                        activeTab === "input"
                          ? "bg-brand-green text-white shadow-sm"
                          : "text-[#6b6560] hover:bg-[#faf9f6] hover:text-[#1a1814]"
                      }`}
                    >
                      <FileText className="w-4.5 h-4.5" />
                      Pelaporan
                    </button>
                    {currentUser?.email?.toLowerCase() === "managementpackaging@gmail.com" && (
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
            <div className="bg-white border-b border-[#e8e4de] py-3 shadow-xs">
              <div className="max-w-7xl mx-auto px-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
                {/* Datepicker Navigation */}
                <div className="flex items-center gap-1 border border-[#e8e4de] bg-[#fcfbfa] p-1.5 rounded-2xl w-full sm:w-auto shadow-xs">
                  <button
                    onClick={handlePrevDay}
                    className="p-1.5 hover:bg-[#faf9f7] rounded-xl text-[#6b6560] hover:text-[#1a1814] active:scale-95 transition-transform"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex items-center bg-white border border-gray-200 shadow-sm rounded-lg p-0.5 cursor-pointer hover:shadow-md transition-shadow">
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-transparent border-none text-sm font-bold text-[#1a1814] focus:outline-none cursor-pointer text-center"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleNextDay}
                    className="p-1.5 hover:bg-[#faf9f7] rounded-xl text-[#6b6560] hover:text-[#1a1814] active:scale-95 transition-transform"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* Today shortcuts & CSV Export action */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    onClick={handleGoToday}
                    className="flex-1 sm:flex-none border-2 border-[#e8e4de] bg-white hover:bg-[#faf9f7] text-[#1a1814] px-4 py-2 rounded-xl text-xs font-bold transition-all"
                  >
                    Hari Ini
                  </button>
                  <button
                    onClick={handleExportCSV}
                    className="flex-1 sm:flex-none border-2 border-[#e8e4de] bg-[#e8f0e6] hover:bg-brand-green-light text-brand-green px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Export CSV
                  </button>
                </div>
              </div>
            </div>

            {/* Main viewports */}
            <main className="flex-1 max-w-7xl mx-auto px-4 md:px-6 py-6 w-full">
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
                        <div className="text-4xl mb-3">📭</div>
                        <h4 className="text-sm font-extrabold text-[#1a1814]">Belum Ada Laporan Pemakaian</h4>
                        <p className="text-xs text-[#9e9892] mt-1 max-w-sm mx-auto">
                          Tidak ada transaksi kantong yang dilaporkan untuk tanggal {selectedDate}. Silakan buka tab <span className="font-bold text-brand-green">Pelaporan</span> untuk menambahkan data baru.
                        </p>
                      </div>
                    ) : (
                      PABRIK_LIST.map((pabrikName) => {
                        // Aggregate data per bag type for this factory
                        const factoryReports = filteredReports.filter((r) => r.pabrik === pabrikName);

                        // Global factory aggregation per bag type
                        const grandFactoryAgg = JENIS_KANTONG.reduce((acc, name) => {
                          acc[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
                          return acc;
                        }, {} as Record<string, { utuh: number; pecah: number; sortir: number; total: number }>);

                        factoryReports.forEach((r) => {
                          if (grandFactoryAgg[r.nama]) {
                            grandFactoryAgg[r.nama].utuh += r.utuh;
                            grandFactoryAgg[r.nama].pecah += r.pecah;
                            grandFactoryAgg[r.nama].sortir += r.sortir;
                            grandFactoryAgg[r.nama].total += r.total;
                          }
                        });

                        return (
                          <div key={pabrikName} className="bg-white border-2 border-[#e8e4de] rounded-3xl p-4 md:p-6 shadow-xs space-y-6">
                            {/* Factory Header */}
                            <div className="flex items-center gap-2 pb-3 border-b-2 border-[#faf9f6]">
                              <span className="text-lg">🏭</span>
                              <h2 className="text-base font-extrabold text-[#1a1814]">{pabrikName}</h2>
                              <span className="ml-auto text-[10px] bg-brand-green-light text-brand-green font-bold px-2 py-0.5 rounded-full">
                                {factoryReports.length} transaksi
                              </span>
                            </div>

                            {/* Consolidated Factory Bag Usage Grid/Table */}
                            <div className="space-y-2">
                              <h3 className="text-xs font-extrabold text-[#6b6560] tracking-wide uppercase mb-2">Konsolidasi Total Hari Ini</h3>
                              <div className="border border-[#e8e4de] rounded-2xl overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className="bg-[#faf9f7] text-[#6b6560] uppercase text-[9px] sm:text-[10px] font-bold border-b border-[#e8e4de]">
                                        <th className="py-2.5 px-2 sm:px-4 font-bold text-[#1a1814]">Jenis Kantong</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-bold text-brand-green text-center">Utuh</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-bold text-rose-600 text-center">Pecah</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-bold text-amber-600 text-center">Sortir</th>
                                        <th className="py-2.5 px-2 sm:px-4 font-bold text-[#1a1814] text-center">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#e8e4de]">
                                      {JENIS_KANTONG.map((name, idx) => {
                                        const stat = grandFactoryAgg[name];
                                        const isZero = stat.utuh === 0 && stat.pecah === 0 && stat.sortir === 0;
                                        return (
                                          <tr key={name} className="hover:bg-[#faf9f7]/50 transition-colors">
                                            <td className="py-2 px-2 sm:px-4 font-bold text-[#1a1814] text-xs sm:text-sm">{JENIS_KANTONG_SHORT[idx]}</td>
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
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>

                            {/* Shift-wise broken down aggregates */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                              {SHIFT_INFO.map((shift) => {
                                const shiftReports = factoryReports.filter((r) => r.shift === shift.id);

                                // Aggregate per bag type for this shift
                                const shiftAgg = JENIS_KANTONG.reduce((acc, name) => {
                                  acc[name] = { utuh: 0, pecah: 0, sortir: 0, total: 0 };
                                  return acc;
                                }, {} as Record<string, { utuh: number; pecah: number; sortir: number; total: number }>);

                                shiftReports.forEach((r) => {
                                  if (shiftAgg[r.nama]) {
                                    shiftAgg[r.nama].utuh += r.utuh;
                                    shiftAgg[r.nama].pecah += r.pecah;
                                    shiftAgg[r.nama].sortir += r.sortir;
                                    shiftAgg[r.nama].total += r.total;
                                  }
                                });

                                return (
                                  <div key={shift.id} className="border border-[#e8e4de] rounded-2xl p-3 bg-[#faf9f7]/40 space-y-3">
                                    <div className="flex items-center gap-1.5 pb-2 border-b border-[#e8e4de]">
                                      <div className={`w-2.5 h-2.5 rounded-full ${shift.id === 1 ? "bg-blue-500" : shift.id === 2 ? "bg-purple-500" : "bg-amber-500"}`} />
                                      <h4 className="text-xs font-extrabold text-[#1a1814]">{shift.label}</h4>
                                      <span className="text-[9px] text-[#9e9892] font-semibold">({shift.time})</span>
                                    </div>

                                    <table className="w-full text-left text-[11px] border-collapse">
                                      <thead>
                                        <tr className="text-[#9e9892] font-extrabold text-[9px] uppercase border-b border-[#e8e4de]">
                                          <th className="pb-1.5 font-bold">Jenis</th>
                                          <th className="pb-1.5 font-bold text-center text-brand-green">U</th>
                                          <th className="pb-1.5 font-bold text-center text-rose-600">P</th>
                                          <th className="pb-1.5 font-bold text-center text-amber-600">S</th>
                                          <th className="pb-1.5 font-bold text-center">Tot</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#e8e4de]/50">
                                        {JENIS_KANTONG.map((name, idx) => {
                                          const sData = shiftAgg[name];
                                          const isZero = sData.utuh === 0 && sData.pecah === 0 && sData.sortir === 0;
                                          return (
                                            <tr key={name} className="hover:bg-white/40">
                                              <td className="py-1 font-bold text-[#6b6560]">{JENIS_KANTONG_SHORT[idx]}</td>
                                              <td className={`py-1 text-center font-medium ${isZero ? "text-[#c4bfb7]" : "text-[#1a1814]"}`}>{sData.utuh}</td>
                                              <td className={`py-1 text-center font-medium ${isZero ? "text-[#c4bfb7]" : "text-rose-600"}`}>{sData.pecah}</td>
                                              <td className={`py-1 text-center font-medium ${isZero ? "text-[#c4bfb7]" : "text-amber-600"}`}>{sData.sortir}</td>
                                              <td className={`py-1 text-center font-bold bg-[#e8f0e6]/10 ${isZero ? "text-[#c4bfb7]" : "text-brand-green"}`}>{sData.total}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </motion.div>
                )}

                {/* VIEWPORT: PELAPORAN DATA LIST */}
                {activeTab === "input" && (
                  <motion.div
                    key="input"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="text-sm font-extrabold text-[#6b6560] tracking-wide uppercase">
                        Daftar Laporan Tanggal: {selectedDate}
                      </h2>
                      <button
                        onClick={handleOpenAddForm}
                        className="bg-brand-green hover:bg-brand-green-hover text-white py-2 px-4 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all"
                      >
                        <Plus className="w-4 h-4" />
                        Tambah Data Baru
                      </button>
                    </div>

                    {filteredReports.length === 0 ? (
                      <div className="bg-white border-2 border-[#e8e4de] rounded-3xl p-12 text-center shadow-xs">
                        <div className="text-4xl mb-3">📝</div>
                        <h4 className="text-sm font-extrabold text-[#1a1814]">Belum Ada Data</h4>
                        <p className="text-xs text-[#9e9892] mt-1 max-w-sm mx-auto">
                          Belum ada transaksi kantong terdaftar untuk tanggal ini. Klik tombol <span className="font-bold text-brand-green">Tambah Data Baru</span> di atas untuk menginput laporan.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Desktop Table View (hidden on small screens) */}
                        <div className="hidden md:block bg-white border-2 border-[#e8e4de] rounded-3xl shadow-xs overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-[#faf9f7] border-b border-[#e8e4de] text-[#6b6560] font-bold uppercase text-[9px] tracking-wider">
                                  <th className="py-3 px-4 text-center w-12">No</th>
                                  <th className="py-3 px-4">Vendor</th>
                                  <th className="py-3 px-4">Jenis Kantong</th>
                                  <th className="py-3 px-4">Pabrik</th>
                                  <th className="py-3 px-4 text-center">Shift</th>
                                  <th className="py-3 px-4 text-center text-brand-green">Utuh</th>
                                  <th className="py-3 px-4 text-center text-rose-600">Pecah</th>
                                  <th className="py-3 px-4 text-center text-amber-600">Sortir</th>
                                  <th className="py-3 px-4 text-center font-extrabold">Total</th>
                                  <th className="py-3 px-4 text-center w-28">Aksi</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#e8e4de]">
                                {filteredReports.map((item, index) => (
                                  <tr key={item.id} className="hover:bg-[#faf9f7]/50 transition-colors">
                                    <td className="py-2.5 px-4 text-center font-bold text-[#9e9892]">{index + 1}</td>
                                    <td className="py-2.5 px-4 font-extrabold text-brand-green text-[13px]">{item.vendor}</td>
                                    <td className="py-2.5 px-4 font-bold text-[#1a1814]">{item.nama}</td>
                                    <td className="py-2.5 px-4 font-semibold text-[#6b6560] text-[11px]">
                                      {item.pabrik.includes("1") ? "PBR 1" : "PBR 2"}
                                    </td>
                                    <td className="py-2.5 px-4 text-center">
                                      <span
                                        className={`inline-block px-2 py-0.5 rounded-md font-bold text-[10px] border ${
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
                                    <td className="py-2.5 px-4 text-center">
                                      <div className="flex items-center justify-center gap-1.5">
                                        <button
                                          onClick={() => handleOpenEditForm(item)}
                                          className="p-1.5 border border-[#e8e4de] hover:border-brand-green hover:bg-brand-green-light text-[#6b6560] hover:text-brand-green rounded-lg transition-all"
                                          title="Edit Baris"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteEntry(item.id)}
                                          className="p-1.5 border border-[#e8e4de] hover:border-rose-200 hover:bg-rose-50 text-[#6b6560] hover:text-rose-600 rounded-lg transition-all"
                                          title="Hapus Baris"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="bg-[#faf9f7]/80 font-bold border-t-2 border-[#e8e4de]">
                                  <td colSpan={5} className="py-3 px-4 text-right font-extrabold text-[#1a1814]">Total Kumulatif</td>
                                  <td className="py-3 px-4 text-center font-extrabold text-brand-green bg-[#e8f0e6]/15">{selectedDateStats.utuh}</td>
                                  <td className="py-3 px-4 text-center font-extrabold text-rose-600 bg-[#e8f0e6]/15">{selectedDateStats.pecah}</td>
                                  <td className="py-3 px-4 text-center font-extrabold text-amber-600 bg-[#e8f0e6]/15">{selectedDateStats.sortir}</td>
                                  <td className="py-3 px-4 text-center font-extrabold text-brand-green bg-[#e8f0e6]/30">{selectedDateStats.total}</td>
                                  <td></td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>

                        {/* Mobile Card View (shown only on mobile/small screens) */}
                        <div className="block md:hidden space-y-4 pb-16">
                          {filteredReports.map((item, index) => (
                            <div key={item.id} className="bg-white border-2 border-[#e8e4de] rounded-2xl p-4 shadow-xs space-y-3 relative overflow-hidden">
                              <div className="absolute top-0 left-0 w-1.5 h-full bg-brand-green" />
                              <div className="flex items-center justify-between pl-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-black text-[#9e9892] bg-[#faf9f7] px-1.5 py-0.5 rounded-md border border-[#e8e4de]">
                                    #{index + 1}
                                  </span>
                                  <span className="font-extrabold text-brand-green text-sm tracking-tight">{item.vendor}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[#6b6560] font-bold text-[9px] uppercase">
                                    {item.pabrik.includes("1") ? "PBR 1" : "PBR 2"}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-bold text-[9px] border ${
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
                                  <div className="text-[9px] font-bold text-brand-green uppercase tracking-wider">Utuh</div>
                                  <div className="text-xs font-extrabold text-[#1a1814] mt-0.5">{item.utuh}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] font-bold text-rose-600 uppercase tracking-wider">Pecah</div>
                                  <div className="text-xs font-extrabold text-rose-600 mt-0.5">{item.pecah}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">Sortir</div>
                                  <div className="text-xs font-extrabold text-amber-600 mt-0.5">{item.sortir}</div>
                                </div>
                                <div className="bg-[#e8f0e6]/40 rounded-lg py-0.5 border border-brand-green/10">
                                  <div className="text-[9px] font-bold text-brand-green uppercase tracking-wider">Total</div>
                                  <div className="text-xs font-black text-brand-green mt-0.5">{item.total}</div>
                                </div>
                              </div>

                              {/* Actions footer */}
                              <div className="flex items-center justify-between pt-2 border-t border-[#faf9f6]">
                                <div className="text-[9px] text-[#9e9892] font-semibold break-all max-w-[50%]">
                                  Oleh: {item.createdBy?.split("@")[0] || "Sistem"}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleOpenEditForm(item)}
                                    className="px-2.5 py-1.5 border border-[#e8e4de] bg-white hover:border-brand-green hover:bg-brand-green-light text-[#6b6560] hover:text-brand-green rounded-lg transition-all text-[11px] font-bold flex items-center gap-1"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteEntry(item.id)}
                                    className="px-2.5 py-1.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg transition-all text-[11px] font-bold flex items-center gap-1"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Hapus
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}

                          {/* Mobile Total Kumulatif card */}
                          <div className="bg-[#faf9f7] border-2 border-brand-green/20 rounded-2xl p-4 shadow-xs space-y-2.5">
                            <h4 className="text-[10px] font-black text-brand-green uppercase tracking-widest text-center">Total Kumulatif Hari Ini</h4>
                            <div className="grid grid-cols-4 gap-1.5 text-center">
                              <div className="bg-white p-2 rounded-xl border border-[#e8e4de]">
                                <div className="text-[9px] font-bold text-brand-green uppercase">Utuh</div>
                                <div className="text-xs font-black text-brand-green mt-0.5">{selectedDateStats.utuh}</div>
                              </div>
                              <div className="bg-white p-2 rounded-xl border border-[#e8e4de]">
                                <div className="text-[9px] font-bold text-rose-600 uppercase">Pecah</div>
                                <div className="text-xs font-black text-rose-600 mt-0.5">{selectedDateStats.pecah}</div>
                              </div>
                              <div className="bg-white p-2 rounded-xl border border-[#e8e4de]">
                                <div className="text-[9px] font-bold text-amber-600 uppercase">Sortir</div>
                                <div className="text-xs font-black text-amber-600 mt-0.5">{selectedDateStats.sortir}</div>
                              </div>
                              <div className="bg-brand-green text-white p-2 rounded-xl border border-brand-green shadow-xs">
                                <div className="text-[9px] font-bold uppercase opacity-90">Total</div>
                                <div className="text-xs font-black mt-0.5">{selectedDateStats.total}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}

                {/* VIEWPORT: USER MANAGEMENT */}
                {activeTab === "users" && currentUser?.email?.toLowerCase() === "managementpackaging@gmail.com" && (
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
                        <h2 className="text-base font-extrabold text-[#1a1814]">Buat Akun & Otorisasi</h2>
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
                          {allowedUsers.length} Terdaftar
                        </span>
                      </div>

                      {/* Desktop Table View (hidden on mobile) */}
                      <div className="hidden md:block border border-[#e8e4de] rounded-2xl overflow-hidden">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[#faf9f7] border-b border-[#e8e4de] text-[#6b6560] font-bold uppercase text-[9px] tracking-wider">
                              <th className="py-2.5 px-4">Alamat Email</th>
                              <th className="py-2.5 px-4">Ditambahkan Pada</th>
                              <th className="py-2.5 px-4 text-center w-24">Aksi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e8e4de]">
                            {allowedUsers.map((usr) => (
                              <tr key={usr.email} className="hover:bg-[#faf9f7]/50 transition-colors">
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-[#1a1814]">{usr.email}</span>
                                    {usr.email.toLowerCase() === "managementpackaging@gmail.com" && (
                                      <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                        Super Admin
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-[#9e9892] font-semibold text-[11px]">
                                  {usr.addedAt ? new Date(usr.addedAt).toLocaleString("id-ID") : "-"}
                                </td>
                                <td className="py-3 px-4 text-center">
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
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Card List View (shown on mobile) */}
                      <div className="block md:hidden space-y-3">
                        {allowedUsers.map((usr) => (
                          <div key={usr.email} className="bg-[#faf9f7] border-2 border-[#e8e4de] rounded-2xl p-4 flex flex-col gap-2 relative overflow-hidden">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-xs text-[#1a1814] break-all">{usr.email}</span>
                                  {usr.email.toLowerCase() === "managementpackaging@gmail.com" && (
                                    <span className="bg-amber-100 text-amber-800 text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                      Super Admin
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[#9e9892] font-medium">
                                  Sejak: {usr.addedAt ? new Date(usr.addedAt).toLocaleString("id-ID") : "-"}
                                </div>
                              </div>

                              <button
                                onClick={() => handleRemoveAllowedUser(usr.email)}
                                disabled={usr.email.toLowerCase() === "managementpackaging@gmail.com"}
                                className={`p-2.5 rounded-xl border transition-all shrink-0 ${
                                  usr.email.toLowerCase() === "managementpackaging@gmail.com"
                                    ? "text-[#c4bfb7] border-slate-200 cursor-not-allowed bg-slate-50"
                                    : "border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600"
                                }`}
                                title="Cabut Izin Akses"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
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
                <span className="text-[10px]">Dashboard</span>
              </button>

              <button
                onClick={() => setActiveTab("input")}
                className={`flex-1 flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition-all ${
                  activeTab === "input" ? "text-brand-green bg-brand-green-light/60 font-bold" : "text-[#9e9892]"
                }`}
              >
                <FileText className="w-5 h-5" />
                <span className="text-[10px]">Pelaporan</span>
              </button>

              {currentUser?.email?.toLowerCase() === "managementpackaging@gmail.com" && (
                <button
                  onClick={() => setActiveTab("users")}
                  className={`flex-1 flex flex-col items-center gap-1 py-1 px-2 rounded-xl transition-all ${
                    activeTab === "users" ? "text-brand-green bg-brand-green-light/60 font-bold" : "text-[#9e9892]"
                  }`}
                >
                  <Users className="w-5 h-5" />
                  <span className="text-[10px]">Users</span>
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
                      Vendor
                    </label>
                    <select
                      value={formVendor}
                      onChange={(e) => setFormVendor(e.target.value)}
                      className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white"
                    >
                      {VENDORS.map((v) => (
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
                      {JENIS_KANTONG.map((jk) => (
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
                    </label>
                    <select
                      value={formPabrik}
                      onChange={(e) => setFormPabrik(e.target.value)}
                      className="w-full px-3 py-2 bg-[#faf9f7] border-2 border-[#e8e4de] rounded-xl text-xs font-bold text-[#1a1814] focus:outline-none focus:border-brand-green focus:bg-white"
                    >
                      {PABRIK_LIST.map((pb) => (
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
    </div>
  );
}
