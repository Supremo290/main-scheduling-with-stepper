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
  studentCount?: number;
  isRegular?: boolean;
  campus?: string;
  lectureRoom?: string; // The room where lecture is held
  lectureBuilding?: string;
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
  UNITS?: number;
  STUDENT_COUNT?: number;
  PRIORITY?: number;
  IS_REGULAR?: boolean;
  LECTURE_ROOM?: string;
}

// ===== ILP Algorithm Interfaces =====
export interface ConflictMatrix {
  [courseYear: string]: {
    [subjectId: string]: Set<string>;
  };
}

export interface SubjectPriority {
  subjectId: string;
  exams: Exam[];
  priority: number;
  type: 'genEd' | 'math' | 'major';
  units: number;
  studentCount: number;
  conflicts: Set<string>;
  isRegular: boolean;
  requiresAdjacent: boolean; // True if multiple sections need adjacent rooms
}

export interface RoomPreference {
  room: string;
  campus: 'BCJ' | 'MAIN' | 'LECAROS';
  building: string;
  floor: number;
  capacity: number;
  type: 'lecture' | 'lab';
  deptPreference: string[];
  isGroundFloor: boolean;
}

export interface SchedulingState {
  assignments: Map<string, ScheduledExam[]>;
  roomUsage: Map<string, Map<string, Set<string>>>; // day -> slot -> rooms used
  studentLoad: Map<string, Map<string, number>>; // courseYear -> day -> count
  campusUsage: Map<string, Map<string, string>>; // day -> courseYear -> campus
  subjectScheduled: Map<string, {day: string, slot: string}>; // subjectId -> slot info
  consecutiveCheck: Map<string, Map<string, Set<string>>>; // courseYear -> day -> subjects
}

export interface SlotOption {
  day: string;
  slot: string;
  slots: string[]; // For multi-slot exams
  cost: number;
  availableRooms: string[];
}

// ===== Existing Interfaces =====
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

export interface DayLoadBalance {
  day: string;
  currentLoad: number;
  targetLoad: number;
  deficit: number;
}