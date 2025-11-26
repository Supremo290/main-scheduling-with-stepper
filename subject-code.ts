// ===== Core Data Interfaces =====
export interface SubjectCode {
  codeNo: string;
  course: string;
  year: string | number;
  dept: string;
}

export interface Exam {
  code: string;
  version: string;
  subjectId: string;
  title: string;
  course: string;
  yearLevel: number;
  lec: number;
  oe: number;
  dept: string;
  instructor: string;
}

export interface ScheduledExam {
  CODE: string;
  SUBJECT_ID: string;
  DESCRIPTIVE_TITLE: string;
  COURSE: string;
  YEAR_LEVEL: number;
  INSTRUCTOR: string;
  DEPT: string;
  OE: number;
  DAY: string;
  SLOT: string;
  ROOM: string;
}

// ===== Grouping Interfaces =====
export interface SubjectGroup {
  subjectId: string;
  subjectTitle: string;
  units: number;
  codes: SubjectCode[];
}

export interface DepartmentGroup {
  dept: string;
  deptCode: string;
  loadingDepartments: string[];
}

export interface ProgramGroup {
  program: string;
  year: number;
  subjects: {
    set: number;
    subjectId: string;
    subjectTitle: string;
    codeNo: string;
  }[];
}

export interface ProgramSchedule {
  program: string;
  year: number;
  dept: string;
  subjects: {
    subjectId: string;
    subjectTitle: string;
    codeNo: string;
    units: number;
  }[];
  schedule: { [slot: string]: string };
  remainingSubjects?: number;
}

// ===== Room Interfaces =====
export interface Rooms {
  roomNumber: string;
  schedule: {
    subjectId: string;
    codeNo: string;
    course: string;
    yearLevel: number;
    dept: string;
    day: string;
    time: string;
    units?: number;
  }[];
}

// ===== Exam Date Interfaces =====
export interface ExamDay {
  date: Date | null;
  am: boolean;
  pm: boolean;
}

export interface ExamGroup {
  name: string;
  days: ExamDay[];
  termYear?: string;
}

// ===== UI Helper Interfaces =====
export interface ToastMessage {
  title: string;
  description: string;
  variant?: string;
}

export interface SafeSlotOption {
  day: string;
  slot: string;
  availableRooms: string[];
}