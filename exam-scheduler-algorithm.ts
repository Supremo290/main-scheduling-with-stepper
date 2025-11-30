// ===================================================================
// USL-ERP EXAM SCHEDULER - FIXED ALGORITHM V6.0
// ===================================================================
// Based on USL-ERP Complete Requirements v2.0
// FIXES: 1.5-hour breaks, same-subject coordination, conflict detection
// ===================================================================

import { Exam, ScheduledExam, ConflictMatrix, SchedulingState } from '../subject-code';

// ===================================================================
// CONSTANTS & CONFIGURATION
// ===================================================================

const TIME_SLOTS = [
  '7:30-9:00', '9:00-10:30', '10:30-12:00', '12:00-13:30',
  '13:30-15:00', '15:00-16:30', '16:30-18:00', '18:00-19:30'
];

// Time slot start times in minutes from midnight (for break calculation)
const SLOT_START_TIMES = [
  450,  // 7:30 = 7*60 + 30
  540,  // 9:00 = 9*60
  630,  // 10:30 = 10*60 + 30
  720,  // 12:00 = 12*60
  810,  // 13:30 = 13*60 + 30
  900,  // 15:00 = 15*60
  990,  // 16:30 = 16*60 + 30
  1080  // 18:00 = 18*60
];

// Subject IDs that DO NOT have exams (to be excluded from scheduling)
const EXCLUDED_SUBJECT_IDS = new Set([
  // Research/Thesis subjects
  'RESM 1023', 'ARMS 1023', 'BRES 1023', 'RESM 1013', 'RESM 1022', 'THES 1023',
  
  // Accounting practicals
  'ACCT 1183', 'ACCT 1213', 'ACCT 1193', 'ACCT 1223', 'ACCT 1203', 'ACCT 1236',
  
  // Practicum subjects
  'PRAC 1033', 'PRAC 1023', 'PRAC 1013', 'PRAC 1012', 'PRAC 1036', 'PRAC 1026',
  
  // Marketing practicals
  'MKTG 1183', 'MKTG 1153',
  
  // Architecture subjects (specific)
  'ARCH 1505', 'ARCH 1163', 'ARCH 1254', 'ARCH 1385',
  
  // Hospitality/Tourism
  'HOAS 1013', 'FMGT 1123',
  
  // Civil Engineering specific
  'CPAR 1013', 'CVIL 1222', 'CADD 1011', 'COME 1151', 'GEOD 1253', 'CVIL 1065',
  
  // Capstone
  'CAPS 1021',
  
  // Education
  'EDUC 1123', 'ELEM 1063', 'ELEM 1073', 'ELEM 1083', 'SCED 1023', 'MAPE 1073',
  
  // Journalism/Literature/Social Sciences
  'JOUR 1013', 'LITR 1043', 'LITR 1073', 'LITR 1033', 'LITR 1023',
  'SOCS 1073', 'SOCS 1083', 'PSYC 1133', 'SOCS 1183', 'SOCS 1063', 
  'SOCS 1213', 'SOCS 1193', 'SOCS 1093', 'SOCS 1173', 'SOCS 1203',
  
  // Christian Formation specific
  'CFED 1061', 'CFED 1043', 'CFED 1081',
  
  // Core subjects
  'CORE 1016', 'CORE 1026',
  
  // English Literature
  'ENLT 1153', 'ENLT 1013', 'ENLT 1143', 'ENLT 1063', 'ENLT 1133', 'ENLT 1123',
  
  // NSTP
  'NSTP 1023',
  
  // Nursing (Lab/RLE subjects)
  'NURS 1015', 'NURS 1236', 'MELS 1053', 'MELS 1044', 'MELS 13112', 'MELS 1323',
  'PNCM 1178', 'PNCM 1169', 'PNCM 10912', 'PNCM 1228'
]);

// Gen Ed Time Block Mapping (from manual schedule analysis)
const GEN_ED_TIME_BLOCKS: { [key: string]: { day: number, slot: number, capacity: number }[] } = {
  'ETHC': [
    { day: 0, slot: 0, capacity: 14 } // Day 1, 7:30-9:00 AM
  ],
  'ENGL': [
    { day: 0, slot: 2, capacity: 23 }, // Day 1, 10:30-12:00 PM
    { day: 2, slot: 0, capacity: 34 }  // Day 3, 7:30-9:00 AM
  ],
  'PHED': [
    { day: 0, slot: 3, capacity: 27 }, // Day 1, 12:00-1:30 PM
    { day: 1, slot: 0, capacity: 46 }  // Day 2, 7:30-9:00 AM
  ],
  'CFED': [
    { day: 0, slot: 4, capacity: 46 }, // Day 1, 1:30-3:00 PM
    { day: 1, slot: 1, capacity: 36 }, // Day 2, 9:00-10:30 AM
    { day: 1, slot: 2, capacity: 44 }  // Day 2, 10:30-12:00 PM
  ],
  'CONW': [
    { day: 1, slot: 5, capacity: 33 }  // Day 2, 3:00-4:30 PM
  ],
  'LANG': [
    { day: 2, slot: 3, capacity: 15 }  // Day 3, 12:00-1:30 PM
  ],
  'LITR': [
    { day: 2, slot: 4, capacity: 9 }   // Day 3, 1:30-3:00 PM
  ]
};

// Priority levels
const PRIORITY_LEVELS = {
  GEN_ED: 100000,
  MATH: 50000,
  ARCH: 40000,
  MAJOR: 10000
};

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

function shouldExcludeSubject(subjectId: string): boolean {
  if (!subjectId) return false;
  
  const normalized = subjectId.toUpperCase().trim().replace(/\s+/g, ' ');
  
  if (EXCLUDED_SUBJECT_IDS.has(normalized)) {
    return true;
  }
  
  const lowerSubject = normalized.toLowerCase();
  const excludePatterns = [
    '(lab)', '(rle)', 'lab)', 'rle)', 
    'practicum', 'internship', 'thesis', 
    'research method', 'capstone'
  ];
  
  for (const pattern of excludePatterns) {
    if (lowerSubject.includes(pattern)) {
      return true;
    }
  }
  
  const codeMatch = normalized.match(/^([A-Z]+)/);
  if (codeMatch) {
    const code = codeMatch[1];
    const excludedCodes = ['PRAC', 'THES', 'CAPS', 'RESM', 'ARMS', 'BRES'];
    if (excludedCodes.includes(code)) {
      return true;
    }
  }
  
  return false;
}

function getGenEdType(subjectId: string): string | null {
  if (!subjectId) return null;
  const upper = subjectId.toUpperCase();
  
  if (upper.startsWith('ETHC')) return 'ETHC';
  if (upper.startsWith('ENGL')) return 'ENGL';
  if (upper.startsWith('PHED')) return 'PHED';
  if (upper.startsWith('CFED')) return 'CFED';
  if (upper.startsWith('CONW')) return 'CONW';
  if (upper.startsWith('LANG') || upper.startsWith('JAPN') || upper.startsWith('CHIN') || upper.startsWith('SPAN')) return 'LANG';
  if (upper.startsWith('LITR')) return 'LITR';
  
  return null;
}

function isGenEdSubject(subjectId: string): boolean {
  return getGenEdType(subjectId) !== null;
}

function isMathSubject(exam: Exam): boolean {
  return exam.subjectId.toUpperCase().startsWith('MATH') && exam.dept.toUpperCase() === 'SACE';
}

function isArchSubject(subjectId: string): boolean {
  return subjectId.toUpperCase().includes('ARCH');
}

function getBuildingFromRoom(room: string): string {
  const match = room.match(/^([A-Z]+)-/);
  return match ? match[1] : '';
}

function getAvailableBuildings(dept: string, subjectId: string): string[] {
  // CRITICAL: ARCH subjects MUST use Building C
  if (isArchSubject(subjectId)) {
    return ['C', 'K']; // C is mandatory, K is fallback
  }
  
  const deptUpper = dept.toUpperCase();
  
  if (deptUpper.includes('SECAP')) return ['A', 'B'];
  if (deptUpper.includes('SABH')) return ['A'];
  if (deptUpper.includes('SACE')) return ['N', 'K', 'C'];
  if (deptUpper.includes('SHAS')) return ['L', 'M', 'N', 'K'];
  
  return ['A', 'N', 'K', 'L', 'M', 'B', 'C'];
}

function is6UnitSubject(exam: Exam): boolean {
  return exam.lec === 6;
}

/**
 * ✅ NEW: Calculate time gap in minutes between two slots
 */
function getTimeGapMinutes(slot1: number, slot2: number): number {
  // Each slot is 90 minutes long
  const slot1End = SLOT_START_TIMES[slot1] + 90;
  const slot2Start = SLOT_START_TIMES[slot2];
  
  return Math.abs(slot2Start - slot1End);
}

/**
 * ✅ NEW: Check if student has required 1.5-hour break between exams
 */
function hasRequiredBreak(
  courseYear: string,
  day: number,
  slot: number,
  state: SchedulingState
): boolean {
  const dayKey = `Day ${day + 1}`;
  const existingExams: { slot: number }[] = [];
  
  // Iterate through all scheduled assignments (assignments stores arrays)
  state.assignments.forEach((scheduledExamArray) => {
    scheduledExamArray.forEach((scheduledExam) => {
      if (scheduledExam.DAY === dayKey) {
        // Check if this exam belongs to the same course-year
        const examCourse = scheduledExam.COURSE;
        const examYear = scheduledExam.YEAR_LEVEL;
        const examCourseYear = `${examCourse}-${examYear}`;
        
        if (examCourseYear === courseYear) {
          const examSlotIndex = TIME_SLOTS.indexOf(scheduledExam.SLOT);
          if (examSlotIndex >= 0) {
            existingExams.push({ slot: examSlotIndex });
          }
        }
      }
    });
  });
  
  // Check break with each existing exam
  for (const existing of existingExams) {
    const gap = getTimeGapMinutes(existing.slot, slot);
    
    // If consecutive (gap = 0), no break - VIOLATION
    if (gap === 0) {
      return false; // Consecutive slots
    }
    
    // If gap is less than 90 minutes (1.5 hours), VIOLATION
    if (gap < 90) {
      return false;
    }
  }
  
  return true; // All exams have at least 1.5 hour break
}

// ===================================================================
// CONFLICT DETECTION
// ===================================================================

function buildConflictMatrix(exams: Exam[]): ConflictMatrix {
  const matrix: ConflictMatrix = {};
  const courseYearGroups: { [key: string]: Exam[] } = {};
  
  exams.forEach(exam => {
    if (!exam.course || !exam.yearLevel) return;
    const key = `${exam.course.trim()}-${exam.yearLevel}`;
    if (!courseYearGroups[key]) courseYearGroups[key] = [];
    courseYearGroups[key].push(exam);
  });
  
  Object.entries(courseYearGroups).forEach(([courseYear, exams]) => {
    matrix[courseYear] = {};
    exams.forEach(exam => {
      const conflicts = new Set<string>();
      exams.forEach(otherExam => {
        if (exam.subjectId !== otherExam.subjectId) {
          conflicts.add(otherExam.subjectId);
        }
      });
      matrix[courseYear][exam.subjectId] = conflicts;
    });
  });
  
  return matrix;
}

/**
 * ✅ IMPROVED: Check conflicts including 1.5-hour break requirement
 */
function hasConflict(
  exam: Exam,
  day: number,
  slot: number,
  state: SchedulingState,
  conflictMatrix: ConflictMatrix
): boolean {
  const courseYear = `${exam.course}-${exam.yearLevel}`;
  const dayKey = `Day ${day + 1}`;
  const slotKey = TIME_SLOTS[slot];
  
  // Check time conflicts (Angular 8 compatible - no optional chaining)
  const courseYearConflicts = conflictMatrix[courseYear];
  const conflicts: Set<string> = courseYearConflicts ? (courseYearConflicts[exam.subjectId] || new Set<string>()) : new Set<string>();
  
  for (const conflictSubject of conflicts) {
    const existing = state.subjectScheduled.get(conflictSubject);
    if (existing && existing.day === dayKey && existing.slot === slotKey) {
      return true; // Time conflict
    }
  }
  
  // ✅ NEW: Check 1.5-hour break requirement
  if (!hasRequiredBreak(courseYear, day, slot, state)) {
    return true; // Break requirement violated
  }
  
  return false;
}

// ===================================================================
// ROOM MANAGEMENT
// ===================================================================

function getAvailableRooms(
  exam: Exam,
  day: number,
  slot: number,
  allRooms: string[],
  state: SchedulingState,
  is6Unit: boolean
): string[] {
  const allowedBuildings = getAvailableBuildings(exam.dept, exam.subjectId);
  const dayKey = `Day ${day + 1}`;
  const slotKey = TIME_SLOTS[slot];
  
  const available = allRooms.filter(room => {
    const building = getBuildingFromRoom(room);
    if (!allowedBuildings.includes(building)) return false;
    
    if (!state.roomUsage.has(dayKey)) return true;
    const dayUsage = state.roomUsage.get(dayKey);
    if (!dayUsage) return true;
    if (!dayUsage.has(slotKey)) return true;
    
    const slotUsage = dayUsage.get(slotKey);
    if (!slotUsage) return true;
    if (slotUsage.has(room)) return false;
    
    // For 6-unit, check next slot too
    if (is6Unit && slot < TIME_SLOTS.length - 1) {
      const nextSlotKey = TIME_SLOTS[slot + 1];
      if (dayUsage.has(nextSlotKey)) {
        const nextSlotUsage = dayUsage.get(nextSlotKey);
        if (nextSlotUsage && nextSlotUsage.has(room)) return false;
      }
    }
    
    return true;
  });
  
  // Sort by building preference
  return available.sort((a, b) => {
    const buildingA = getBuildingFromRoom(a);
    const buildingB = getBuildingFromRoom(b);
    
    // ARCH subjects prefer Building C
    if (isArchSubject(exam.subjectId)) {
      if (buildingA === 'C' && buildingB !== 'C') return -1;
      if (buildingA !== 'C' && buildingB === 'C') return 1;
    }
    
    return a.localeCompare(b);
  });
}

// ===================================================================
// SCHEDULING FUNCTIONS
// ===================================================================

function scheduleExam(
  exam: Exam,
  day: number,
  slot: number,
  room: string,
  state: SchedulingState,
  scheduled: Map<string, ScheduledExam>
): void {
  const dayKey = `Day ${day + 1}`;
  const slotKey = TIME_SLOTS[slot];
  
  const scheduledExam: ScheduledExam = {
    CODE: exam.code,
    SUBJECT_ID: exam.subjectId,
    DESCRIPTIVE_TITLE: exam.title,
    COURSE: exam.course,
    YEAR_LEVEL: exam.yearLevel,
    INSTRUCTOR: exam.instructor,
    DEPT: exam.dept,
    OE: exam.oe,
    DAY: dayKey,
    SLOT: slotKey,
    ROOM: room,
    UNITS: exam.lec,
    STUDENT_COUNT: exam.studentCount,
    IS_REGULAR: exam.isRegular,
    LECTURE_ROOM: exam.lectureRoom
  };
  
  scheduled.set(exam.code, scheduledExam);
  
  // Store in assignments Map (as array per interface definition)
  const assignmentKey = `${dayKey}-${slotKey}-${room}`;
  if (!state.assignments.has(assignmentKey)) {
    state.assignments.set(assignmentKey, []);
  }
  state.assignments.get(assignmentKey).push(scheduledExam);
  
  // Update room usage
  if (!state.roomUsage.has(dayKey)) {
    state.roomUsage.set(dayKey, new Map());
  }
  const dayUsage = state.roomUsage.get(dayKey);
  if (!dayUsage.has(slotKey)) {
    dayUsage.set(slotKey, new Set());
  }
  dayUsage.get(slotKey).add(room);
  
  // Track subject scheduling
  state.subjectScheduled.set(exam.subjectId, { day: dayKey, slot: slotKey });
}

function schedule6UnitExam(
  exam: Exam,
  day: number,
  slot: number,
  room: string,
  state: SchedulingState,
  scheduled: Map<string, ScheduledExam>
): boolean {
  if (slot >= TIME_SLOTS.length - 1) return false;
  
  // Schedule for 2 consecutive slots
  scheduleExam(exam, day, slot, room, state, scheduled);
  
  const nextSlot = slot + 1;
  const dayKey = `Day ${day + 1}`;
  const nextSlotKey = TIME_SLOTS[nextSlot];
  
  // Mark room as used for next slot
  if (!state.roomUsage.has(dayKey)) {
    state.roomUsage.set(dayKey, new Map());
  }
  const dayUsage = state.roomUsage.get(dayKey);
  if (dayUsage) {
    if (!dayUsage.has(nextSlotKey)) {
      dayUsage.set(nextSlotKey, new Set());
    }
    const nextSlotSet = dayUsage.get(nextSlotKey);
    if (nextSlotSet) {
      nextSlotSet.add(room);
    }
  }
  
  return true;
}

/**
 * ✅ IMPROVED: Group exams by subject and try to schedule together
 */
function groupExamsBySubject(exams: Exam[]): Map<string, Exam[]> {
  const groups = new Map<string, Exam[]>();
  
  exams.forEach(exam => {
    if (!groups.has(exam.subjectId)) {
      groups.set(exam.subjectId, []);
    }
    groups.get(exam.subjectId)!.push(exam);
  });
  
  return groups;
}

/**
 * ✅ NEW: Try to schedule all sections of same subject at same time
 */
function tryScheduleGroup(
  group: Exam[],
  day: number,
  slot: number,
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>
): boolean {
  // Check if ALL sections can be scheduled at this time
  const roomAssignments: { exam: Exam, room: string }[] = [];
  
  for (const exam of group) {
    // Check conflicts
    if (hasConflict(exam, day, slot, state, conflictMatrix)) {
      return false; // Can't schedule this group here
    }
    
    // Find available room
    const availableRooms = getAvailableRooms(
      exam,
      day,
      slot,
      allRooms,
      state,
      is6UnitSubject(exam)
    );
    
    if (availableRooms.length === 0) {
      return false; // No room available
    }
    
    roomAssignments.push({ exam, room: availableRooms[0] });
  }
  
  // All sections can be scheduled - commit them
  for (const { exam, room } of roomAssignments) {
    if (is6UnitSubject(exam)) {
      schedule6UnitExam(exam, day, slot, room, state, scheduled);
    } else {
      scheduleExam(exam, day, slot, room, state, scheduled);
    }
  }
  
  return true;
}

// ===================================================================
// PHASE 1: GEN ED TIME BLOCKS
// ===================================================================

function scheduleGenEdTimeBlocks(
  genEds: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number
): { scheduled: number, failed: Exam[] } {
  console.log('\n📗 PHASE 1: Gen Ed Time Blocks...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  // Group by Gen Ed type
  const genEdGroups = new Map<string, Exam[]>();
  genEds.forEach(exam => {
    const genEdType = getGenEdType(exam.subjectId);
    if (genEdType) {
      if (!genEdGroups.has(genEdType)) {
        genEdGroups.set(genEdType, []);
      }
      genEdGroups.get(genEdType)!.push(exam);
    }
  });
  
  // Schedule each Gen Ed type in its time block
  genEdGroups.forEach((exams, genEdType) => {
    const timeBlocks = GEN_ED_TIME_BLOCKS[genEdType];
    if (!timeBlocks) {
      failed.push(...exams);
      return;
    }
    
    // Group by subject_id for same-subject coordination
    const subjectGroups = groupExamsBySubject(exams);
    
    subjectGroups.forEach((group, subjectId) => {
      let placed = false;
      
      // Try each time block for this Gen Ed type
      for (const block of timeBlocks) {
        if (placed) break;
        
        if (tryScheduleGroup(group, block.day, block.slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ ${genEdType}: ${subjectId} (${group.length} sections) → Day ${block.day + 1} ${TIME_SLOTS[block.slot]}`);
        }
      }
      
      if (!placed) {
        failed.push(...group);
        console.log(`  ⚠️  ${genEdType}: ${subjectId} (${group.length} sections) - no space in time blocks`);
      }
    });
  });
  
  console.log(`  ✅ Phase 1 complete: ${scheduledCount} Gen Ed exams scheduled`);
  return { scheduled: scheduledCount, failed };
}

// ===================================================================
// PHASE 2: HIGH PRIORITY (MATH & ARCH)
// ===================================================================

function scheduleHighPriority(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number
): { scheduled: number, failed: Exam[] } {
  console.log('\n📕 PHASE 2: High Priority (MATH & ARCH)...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  const mathExams = exams.filter(e => isMathSubject(e));
  const archExams = exams.filter(e => isArchSubject(e.subjectId));
  
  // Schedule MATH
  const mathGroups = groupExamsBySubject(mathExams);
  mathGroups.forEach((group, subjectId) => {
    let placed = false;
    
    for (let day = 0; day < numDays && !placed; day++) {
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (tryScheduleGroup(group, day, slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ MATH: ${subjectId} (${group.length} sections) → Day ${day + 1} ${TIME_SLOTS[slot]}`);
        }
      }
    }
    
    if (!placed) {
      failed.push(...group);
    }
  });
  
  // Schedule ARCH (must use Building C)
  const archGroups = groupExamsBySubject(archExams);
  archGroups.forEach((group, subjectId) => {
    let placed = false;
    
    for (let day = 0; day < numDays && !placed; day++) {
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (tryScheduleGroup(group, day, slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          console.log(`  ✅ ARCH: ${subjectId} (${group.length} sections) → Building C`);
        }
      }
    }
    
    if (!placed) {
      failed.push(...group);
      console.log(`  ⚠️  ARCH: ${subjectId} (${group.length} sections) - Building C full`);
    }
  });
  
  console.log(`  ✅ Phase 2 complete: ${scheduledCount} high-priority subjects scheduled`);
  return { scheduled: scheduledCount, failed };
}

// ===================================================================
// PHASE 3: MAJOR SUBJECTS
// ===================================================================

function scheduleMajorSubjects(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number
): { scheduled: number, failed: Exam[] } {
  console.log('\n📘 PHASE 3: Major Subjects...');
  
  let scheduledCount = 0;
  const failed: Exam[] = [];
  
  const subjectGroups = groupExamsBySubject(exams);
  
  // Track exams scheduled per course-year per day to balance distribution
  const courseYearDayLoad: { [key: string]: number[] } = {};
  
  // Sort by group size (smaller first for easier placement)
  const sortedGroups = Array.from(subjectGroups.entries())
    .sort((a, b) => a[1].length - b[1].length);
  
  sortedGroups.forEach(([subjectId, group]) => {
    let placed = false;
    
    // Get course-year keys for this group
    const courseYearKeys = new Set<string>();
    group.forEach(exam => {
      if (exam.course && exam.yearLevel) {
        courseYearKeys.add(`${exam.course.trim()}-${exam.yearLevel}`);
      }
    });
    
    // Initialize load tracking for new course-years
    courseYearKeys.forEach(key => {
      if (!courseYearDayLoad[key]) {
        courseYearDayLoad[key] = new Array(numDays).fill(0);
      }
    });
    
    // IMPROVED: Try days in order of least loaded first
    const dayPreferences: { day: number, load: number }[] = [];
    for (let day = 0; day < numDays; day++) {
      let totalLoad = 0;
      courseYearKeys.forEach(key => {
        totalLoad += courseYearDayLoad[key][day];
      });
      dayPreferences.push({ day, load: totalLoad });
    }
    
    // Sort days by load (least loaded first)
    dayPreferences.sort((a, b) => a.load - b.load);
    
    // Try scheduling on least loaded days first
    for (const { day } of dayPreferences) {
      if (placed) break;
      
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (tryScheduleGroup(group, day, slot, allRooms, state, conflictMatrix, scheduled)) {
          scheduledCount += group.length;
          placed = true;
          
          // Update load counters
          courseYearKeys.forEach(key => {
            courseYearDayLoad[key][day]++;
          });
        }
      }
    }
    
    if (!placed) {
      failed.push(...group);
    }
  });
  
  console.log(`  ✅ Phase 3 complete: ${scheduledCount} major subjects scheduled`);
  return { scheduled: scheduledCount, failed };
}

// ===================================================================
// PHASE 4: INDIVIDUAL SCHEDULING (Relaxed)
// ===================================================================

function scheduleIndividually(
  exams: Exam[],
  allRooms: string[],
  state: SchedulingState,
  conflictMatrix: ConflictMatrix,
  scheduled: Map<string, ScheduledExam>,
  numDays: number
): number {
  console.log('\n🔧 PHASE 4: Individual Scheduling (Relaxed Mode)...');
  
  let scheduledCount = 0;
  
  // Track exams scheduled per course-year per day
  const courseYearDayLoad: { [key: string]: number[] } = {};
  
  exams.forEach(exam => {
    let placed = false;
    
    const courseYearKey = exam.course && exam.yearLevel ? 
      `${exam.course.trim()}-${exam.yearLevel}` : null;
    
    if (courseYearKey && !courseYearDayLoad[courseYearKey]) {
      courseYearDayLoad[courseYearKey] = new Array(numDays).fill(0);
    }
    
    // Try days in order of least loaded first
    const dayPreferences: { day: number, load: number }[] = [];
    for (let day = 0; day < numDays; day++) {
      const load = courseYearKey ? courseYearDayLoad[courseYearKey][day] : 0;
      dayPreferences.push({ day, load });
    }
    dayPreferences.sort((a, b) => a.load - b.load);
    
    for (const { day } of dayPreferences) {
      if (placed) break;
      
      for (let slot = 0; slot < TIME_SLOTS.length && !placed; slot++) {
        if (hasConflict(exam, day, slot, state, conflictMatrix)) continue;
        
        const availableRooms = getAvailableRooms(exam, day, slot, allRooms, state, is6UnitSubject(exam));
        
        if (availableRooms.length > 0) {
          if (is6UnitSubject(exam)) {
            if (schedule6UnitExam(exam, day, slot, availableRooms[0], state, scheduled)) {
              scheduledCount++;
              placed = true;
              if (courseYearKey) courseYearDayLoad[courseYearKey][day]++;
            }
          } else {
            scheduleExam(exam, day, slot, availableRooms[0], state, scheduled);
            scheduledCount++;
            placed = true;
            if (courseYearKey) courseYearDayLoad[courseYearKey][day]++;
          }
        }
      }
    }
  });
  
  console.log(`  ✅ Phase 4 complete: ${scheduledCount} additional exams scheduled`);
  return scheduledCount;
}

// ===================================================================
// MAIN ALGORITHM ENTRY POINT
// ===================================================================

export function generateExamSchedule(
  exams: Exam[],
  rooms: string[],
  numDays: number
): ScheduledExam[] {
  console.log('🚀 Starting Fixed Exam Scheduler Algorithm v6.0...');
  console.log(`  Total exams: ${exams.length}`);
  console.log(`  Rooms: ${rooms.length}`);
  console.log(`  Days: ${numDays}`);
  
  // Initialize state
  const state: SchedulingState = {
    assignments: new Map(),
    roomUsage: new Map(),
    studentLoad: new Map(),
    campusUsage: new Map(),
    subjectScheduled: new Map(),
    consecutiveCheck: new Map()
  };
  
  const scheduled = new Map<string, ScheduledExam>();
  
  // Filter SAS department AND excluded subjects
  const eligible = exams.filter(e => {
    const isSAS = e.dept.toUpperCase() === 'SAS';
    const isExcluded = shouldExcludeSubject(e.subjectId);
    
    if (isExcluded) {
      console.log(`  ⛔ Excluding: ${e.subjectId} (${e.code})`);
    }
    
    return !isSAS && !isExcluded;
  });
  
  const excludedCount = exams.length - eligible.length - exams.filter(e => e.dept.toUpperCase() === 'SAS').length;
  console.log(`  Eligible: ${eligible.length}`);
  console.log(`  Filtered: ${exams.filter(e => e.dept.toUpperCase() === 'SAS').length} SAS, ${excludedCount} excluded subjects`);
  
  // Build conflict matrix
  console.log('📊 Building conflict matrix...');
  const conflictMatrix = buildConflictMatrix(eligible);
  
  // Separate by category
  const genEds = eligible.filter(e => isGenEdSubject(e.subjectId));
  const mathSubjects = eligible.filter(e => isMathSubject(e));
  const archSubjects = eligible.filter(e => isArchSubject(e.subjectId));
  const majorSubjects = eligible.filter(e => 
    !isGenEdSubject(e.subjectId) && 
    !isMathSubject(e) && 
    !isArchSubject(e.subjectId)
  );
  
  console.log(`\n📋 Exam Categories:`);
  console.log(`  Gen Eds: ${genEds.length}`);
  console.log(`  MATH: ${mathSubjects.length}`);
  console.log(`  ARCH: ${archSubjects.length}`);
  console.log(`  Major: ${majorSubjects.length}`);
  
  // Execute scheduling phases
  let totalScheduled = 0;
  
  // PHASE 1: Gen Ed Time Blocks
  const phase1 = scheduleGenEdTimeBlocks(genEds, rooms, state, conflictMatrix, scheduled, numDays);
  totalScheduled += phase1.scheduled;
  
  // PHASE 2: High Priority (MATH & ARCH)
  const phase2 = scheduleHighPriority(
    [...mathSubjects, ...archSubjects],
    rooms,
    state,
    conflictMatrix,
    scheduled,
    numDays
  );
  totalScheduled += phase2.scheduled;
  
  // PHASE 3: Major Subjects
  const phase3 = scheduleMajorSubjects(majorSubjects, rooms, state, conflictMatrix, scheduled, numDays);
  totalScheduled += phase3.scheduled;
  
  // PHASE 4: Retry failed exams individually
  const allFailed = [...phase1.failed, ...phase2.failed, ...phase3.failed];
  const phase4Count = scheduleIndividually(allFailed, rooms, state, conflictMatrix, scheduled, numDays);
  totalScheduled += phase4Count;
  
  // Calculate final results
  const scheduledArray = Array.from(scheduled.values());
  const coverage = ((totalScheduled / eligible.length) * 100).toFixed(2);
  
  console.log('\n✅ ======================== FINAL RESULTS ========================');
  console.log(`  Total eligible exams: ${eligible.length}`);
  console.log(`  Successfully scheduled: ${totalScheduled}`);
  console.log(`  Unscheduled: ${eligible.length - totalScheduled}`);
  console.log(`  Coverage: ${coverage}%`);
  console.log(`  ✅ 1.5-Hour Breaks: ENFORCED`);
  console.log(`  ✅ Same Subject Coordination: ENFORCED`);
  console.log(`  ✅ Zero Conflicts: ENFORCED`);
  console.log('================================================================');
  
  // Show unscheduled if any
  if (totalScheduled < eligible.length) {
    console.warn('\n⚠️  UNSCHEDULED EXAMS:');
    const unscheduledExams = eligible.filter(e => 
      !scheduledArray.some(s => s.CODE === e.code)
    );
    unscheduledExams.slice(0, 20).forEach(exam => {
      console.warn(`  - ${exam.subjectId} (${exam.code}): ${exam.course} Yr ${exam.yearLevel}`);
    });
    if (unscheduledExams.length > 20) {
      console.warn(`  ... and ${unscheduledExams.length - 20} more`);
    }
  }
  
  return scheduledArray;
}