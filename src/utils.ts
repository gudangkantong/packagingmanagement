export const getDateString = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  
  const date = new Date(year, month - 1, day);
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const dayName = days[date.getDay()];
  
  return `${dayName}, ${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
};
