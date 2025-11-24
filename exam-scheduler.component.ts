import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../api.service';
import { GlobalService } from '../global.service';
import { MatDialog } from '@angular/material';
import { map } from 'rxjs/operators';
import Swal from 'sweetalert2';
import { SharedDataService } from '../shared-data.service';
import { DatePickerComponent } from '../date-picker/date-picker.component';

interface Exam {
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

interface ScheduledExam {
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

interface ToastMessage {
  title: string;
  description: string;
  variant?: string;
}

interface SafeSlotOption {
  day: string;
  slot: string;
  availableRooms: string[];
}

interface ExamDay {
  date: Date | null;
  am: boolean;
  pm: boolean;
}

interface ExamGroup {
  name: string;
  days: ExamDay[];
  termYear?: string;
}

@Component({
  selector: 'app-exam-scheduler',
  templateUrl: './exam-scheduler.component.html',
  styleUrls: ['./exam-scheduler.component.scss']
})
export class ExamSchedulerComponent implements OnInit {
  currentStep: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' = 'import';
  
  rawCodes: any[] = [];
  exams: Exam[] = [];
  rooms: string[] = [];
  roomCapacities: Map<string, number> = new Map();
  generatedSchedule: ScheduledExam[] = [];
  examDates: string[] = ['', '', ''];
  
  editingRow: number | null = null;
  editedExam: ScheduledExam | null = null;
  
  activeTerm: string = '';
  combinedOptions: { label: string, value: string }[] = [];
  termOptions = [
    { key: 1, value: '1st Term' },
    { key: 2, value: '2nd Term' },
    { key: 3, value: 'Summer' },
  ];
  
  isLoadingApi: boolean = false;
  
  timeSlots: string[] = [
    '7:30-9:00',
    '9:00-10:30',
    '10:30-12:00',
    '12:00-1:30',
    '1:30-3:00',
    '3:00-4:30',
    '4:30-6:00',
    '6:00-7:30'
  ];
  
  days: string[] = ['Day 1', 'Day 2', 'Day 3'];
  activeDay: string = 'Day 1';
  toast: ToastMessage | null = null;
  
  courseSummary: any[] = [];
  roomTimeData: any = { table: {}, rooms: [], days: [] };
  courseGridData: any = { grid: {}, courses: [], days: [] };

  movePopupVisible = false;
  moveExamData: any = null;
  safeSlots: SafeSlotOption[] = [];

  savedExamGroups: ExamGroup[] = [];
  selectedExamGroup: ExamGroup | null = null;
  showExamGroupManager: boolean = false;
  
  useEnhancedAlgorithm: boolean = true;
  subjectTypes: Map<string, 'genEd' | 'major'> = new Map();

  constructor(
    public api: ApiService, 
    public global: GlobalService, 
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private http: HttpClient, 
    private cd: ChangeDetectorRef,
    private sharedData: SharedDataService
  ) {}

  ngOnInit() {
    this.activeDay = this.days[0];
    this.roomTimeData.days = [...this.days];
    this.courseGridData.days = [...this.days];
    this.courseGridData.courses = [];
    
    this.combineYearTerm();
    
    this.loadSavedExamGroups();
    
    this.sharedData.selectedExamGroup$.subscribe(group => {
      if (group) {
        this.selectedExamGroup = group;
        this.examDates = group.days.map(d => 
          d.date ? new Date(d.date).toLocaleDateString('en-CA') : ''
        );
        this.activeTerm = group.termYear || '';
        console.log('✅ Selected exam group:', group.name);
      }
    });
    
    if (this.hasSavedData()) {
      this.showRestorePrompt();
    }
  }

  combineYearTerm() {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of this.termOptions) {
        const label = `${t.value} ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.combinedOptions.push({ label, value });
      }
    }
  }

  loadSavedExamGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  toggleExamGroupManager() {
    this.showExamGroupManager = !this.showExamGroupManager;
  }

  selectExamGroup(group: ExamGroup) {
    this.selectedExamGroup = group;
    this.activeTerm = group.termYear || '';
    
    this.examDates = group.days.map(d => 
      d.date ? new Date(d.date).toLocaleDateString('en-CA') : ''
    ).filter(d => d !== '');
    
    this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
    
    this.sharedData.setSelectedExamGroup(group);
    this.sharedData.setExamDates(group.days);
    if (group.termYear) {
      this.sharedData.setActiveTerm(group.termYear);
    }
    
    this.showToast('Success', `Selected "${group.name}" with ${this.examDates.length} exam days`);
    this.showExamGroupManager = false;
  }

  loadExamData() {
    if (!this.activeTerm) {
      this.global.swalAlertError('Please select a term/year first');
      return;
    }

    this.loadSwal();
    
    this.api.getCodeSummaryReport(this.activeTerm)
      .map((response: any) => response.json())
      .subscribe(
        res => {
          this.rawCodes = res.data;
          Swal.close();

          const parsedExams: Exam[] = this.rawCodes.map((obj: any) => ({
            code: obj.codeNo || '',
            version: obj.version || '',
            subjectId: obj.subjectId || '',
            title: obj.subjectTitle || '',
            course: (obj.course || '').trim(),
            yearLevel: obj.yearLevel !== undefined && obj.yearLevel !== null ? obj.yearLevel : 1,
            lec: parseInt(obj.lecUnits || 3),
            oe: parseInt(obj.labUnits || 0),
            dept: obj.dept || '',
            instructor: obj.instructor || ''
          }));

          this.exams = parsedExams;
          this.rooms = this.getUniqueRooms(res.data);
          
          this.extractRoomCapacities(res.data);
          
          this.categorizeSubjects();
          
          if (this.rooms.length === 0) {
            this.rooms = ['A', 'C', 'K', 'L', 'M', 'N'];
          }
          
          this.sharedData.getRoomSummary(res.data);
          
          this.showToast('Success', `${parsedExams.length} exams loaded from API`);
        },
        err => {
          Swal.close();
          this.global.swalAlertError(err);
        }
      );
  }

  extractRoomCapacities(data: any[]) {
    this.roomCapacities.clear();
    data.forEach(item => {
      if (item.roomNumber && item.classSize) {
        const room = item.roomNumber.trim();
        const capacity = parseInt(item.classSize) || 0;
        const currentCapacity = this.roomCapacities.get(room);
        if (!currentCapacity || currentCapacity < capacity) {
          this.roomCapacities.set(room, capacity);
        }
      }
    });
    console.log('✅ Extracted capacities for', this.roomCapacities.size, 'rooms');
  }

  categorizeSubjects() {
    this.subjectTypes.clear();
    
    const subjectCourseCount = new Map<string, Set<string>>();
    
    this.exams.forEach(exam => {
      if (!subjectCourseCount.has(exam.subjectId)) {
        subjectCourseCount.set(exam.subjectId, new Set());
      }
      const courses = subjectCourseCount.get(exam.subjectId);
      if (courses) {
        courses.add(exam.course);
      }
    });
    
    subjectCourseCount.forEach((courses, subjectId) => {
      const type = courses.size >= 15 ? 'genEd' : 'major';
      this.subjectTypes.set(subjectId, type);
    });
    
    console.log('✅ Categorized', this.subjectTypes.size, 'subjects');
  }

  getUniqueRooms(data: any[]): string[] {
    const roomSet = new Set<string>();
    const excludedRooms = [
      'B-11', 'B-12','BTL -','BUL -','HL','J-42','J-43','J-44','J-45','J-46','J-48','K-13',
      'K-14','K-22','K-24','K-41','L-23','M-21','M-31','M-33','M-43','MChem','MLab1','MLab2',
      'Nutri','SMTL','A-102','A-203','A-204','A-205','A-219','A-221','A-225','A-226','A-234',
      'A-302','A-306','A-308','A-309','A-310','A-311','A-312','DemoR','Pharm', 'TBA', 'to be', 
      'Virtu', 'EMC', 'Field', 'Hosp', 'Molec'
    ];
    
    data.forEach(item => {
      if (item.roomNumber || item.ROOM_NUMBER || item.ROOM) {
        const room = (item.roomNumber || item.ROOM_NUMBER || item.ROOM).trim();
        if (!excludedRooms.includes(room)) {
          roomSet.add(room);
        }
      }
    });
    return Array.from(roomSet).sort();
  }

  loadSwal() {
    Swal.fire({
      title: 'Loading',
      text: 'Fetching exam data...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: function () {
        Swal.showLoading();
      }
    });
  }

  showToast(title: string, description: string, variant: string = 'success') {
    this.toast = { title, description, variant };
    setTimeout(() => {
      this.toast = null;
    }, 3000);
  }

  areSlotConsecutive(slot1: string, slot2: string): boolean {
    const idx1 = this.timeSlots.indexOf(slot1);
    const idx2 = this.timeSlots.indexOf(slot2);
    return Math.abs(idx1 - idx2) === 1;
  }

  hasConsecutiveExamsInSlot(course: string, day: string, proposedSlot: string, excludeSubjectId?: string): boolean {
    const courseExamsOnDay = this.generatedSchedule.filter(
      e => e.COURSE.toUpperCase().trim() === course.toUpperCase().trim() && 
           e.DAY === day &&
           (!excludeSubjectId || e.SUBJECT_ID !== excludeSubjectId)
    );

    for (const exam of courseExamsOnDay) {
      if (this.areSlotConsecutive(exam.SLOT, proposedSlot)) {
        return true;
      }
    }
    return false;
  }

  assignRoomByDepartment(exam: Exam, usedRoomsSet: Set<string>, roomsList: string[]): string | null {
    const dept = exam.dept ? exam.dept.toUpperCase() : '';
    const course = exam.course ? exam.course.toUpperCase() : '';

    let preferredPrefixes: string[] = [];

    if (dept === 'SABH' || dept === 'SECAP') {
      preferredPrefixes = ['A'];
    } else if (course.startsWith('BSA')) {
      preferredPrefixes = ['C', 'K'];
    } else if (dept === 'SACE') {
      preferredPrefixes = ['N', 'K'];
    } else if (dept === 'SHAS') {
      preferredPrefixes = ['M', 'L'];
    }

    const availableRooms = roomsList
      .filter(r => !usedRoomsSet.has(r))
      .sort((a, b) => {
        const capA = this.roomCapacities.get(a) || 0;
        const capB = this.roomCapacities.get(b) || 0;
        return capB - capA;
      });

    let availableRoom = availableRooms.find(r =>
      preferredPrefixes.some(prefix => r.startsWith(prefix))
    );

    if (!availableRoom) {
      availableRoom = availableRooms[0];
    }

    return availableRoom || null;
  }

  generateExamSchedule() {
    if (this.exams.length === 0) {
      this.showToast('Error', 'Please import exams first', 'destructive');
      return;
    }

    if (this.examDates.some(d => !d)) {
      this.showToast('Error', 'Please set all exam dates first', 'destructive');
      return;
    }

    Swal.fire({
      title: 'Choose Generation Method',
      html: `
        <div style="text-align: left; padding: 10px;">
          <p><strong>Basic Algorithm:</strong></p>
          <ul style="margin-left: 20px; font-size: 14px;">
            <li>Fast generation</li>
            <li>Simple rules</li>
            <li>Good for drafts</li>
          </ul>
          <br>
          <p><strong>Enhanced Algorithm:</strong></p>
          <ul style="margin-left: 20px; font-size: 14px;">
            <li>1.5-hour breaks enforced</li>
            <li>Gen-Ed NOT at 7:30 AM</li>
            <li>No back-to-back majors</li>
            <li>Even distribution</li>
            <li>Capacity-aware rooms</li>
          </ul>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Enhanced Algorithm',
      cancelButtonText: 'Basic Algorithm',
      customClass: {
        popup: 'swal-wide'
      }
    }).then((result) => {
      if (result.value) {
        this.generateEnhancedSchedule();
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        this.generateBasicSchedule();
      }
    });
  }

  generateBasicSchedule() {
    const roomsList = this.rooms.length > 0 ? this.rooms.sort() : ['A', 'C', 'K', 'L', 'M', 'N'];
    const schedule: ScheduledExam[] = [];

    const courseGroups: { [course: string]: Exam[] } = {};
    this.exams.forEach(exam => {
      const course = exam.course.toUpperCase().trim();
      if (!courseGroups[course]) courseGroups[course] = [];
      courseGroups[course].push(exam);
    });

    const usedRoomsBySlot: { [key: string]: Set<string> } = {};
    const courseLastSlot: { [course: string]: number } = {};
    const subjectIdSlot: { [subjectId: string]: { day: string; slots: string[] } } = {};
    const sameExamDay: { [key: string]: string } = {};

    let slotIndex = 0;

    for (const course of Object.keys(courseGroups)) {
      const courseExams = courseGroups[course];
      const totalExams = courseExams.length;

      let allowedDays: string[] = [];
      if (totalExams <= 3) {
        allowedDays = [this.days[0]];
      } else if (totalExams <= 6) {
        allowedDays = [this.days[0], this.days[1]];
      } else {
        allowedDays = [...this.days];
      }

      let dayIndex = 0;

      for (const exam of courseExams) {
        const subjectId = exam.subjectId ? exam.subjectId.toUpperCase().trim() : '';
        const title = exam.title ? exam.title.toUpperCase().trim() : '';
        const examKey = `${course}_${title}`;
        
        const totalUnits = exam.lec + exam.oe;
        const slotsNeeded = totalUnits >= 5 ? 2 : 1;

        let day = '';
        if (sameExamDay[examKey]) {
          day = sameExamDay[examKey];
        } else {
          day = allowedDays[dayIndex % allowedDays.length];
          sameExamDay[examKey] = day;
          dayIndex++;
        }

        let slots: string[] = [];
        if (subjectIdSlot[subjectId]) {
          day = subjectIdSlot[subjectId].day;
          slots = subjectIdSlot[subjectId].slots;
        } else {
          if (subjectId.includes('CFED')) {
            const allowedSlots = this.timeSlots.filter(t => !t.startsWith('7:30'));
            for (let i = 0; i < slotsNeeded; i++) {
              slots.push(allowedSlots[(slotIndex + i) % allowedSlots.length]);
            }
            slotIndex += slotsNeeded;
          } else {
            let attempts = 0;
            while (slots.length < slotsNeeded) {
              const slot = this.timeSlots[slotIndex % this.timeSlots.length];
              slotIndex++;
              attempts++;
              if (attempts > this.timeSlots.length * 3) {
                slots.push(slot);
              } else if (
                courseLastSlot[course] === undefined ||
                Math.abs(this.timeSlots.indexOf(slot) - courseLastSlot[course]) > 1
              ) {
                slots.push(slot);
              }
            }
          }
          subjectIdSlot[subjectId] = { day, slots };
        }

        courseLastSlot[course] = this.timeSlots.indexOf(slots[slots.length - 1]);

        slots.forEach(slot => {
          const slotKey = `${day}|${slot}`;
          if (!usedRoomsBySlot[slotKey]) usedRoomsBySlot[slotKey] = new Set<string>();

          const availableRoom = this.assignRoomByDepartment(exam, usedRoomsBySlot[slotKey], roomsList);

          if (availableRoom) {
            usedRoomsBySlot[slotKey].add(availableRoom);
            schedule.push({
              CODE: exam.code,
              SUBJECT_ID: exam.subjectId,
              DESCRIPTIVE_TITLE: exam.title,
              COURSE: exam.course,
              YEAR_LEVEL: exam.yearLevel,
              INSTRUCTOR: exam.instructor,
              DEPT: exam.dept,
              OE: exam.oe,
              DAY: day,
              SLOT: slot,
              ROOM: availableRoom
            });
          }
        });
      }
    }

    this.generatedSchedule = schedule;
    this.currentStep = 'generate';
    this.showToast('Schedule Generated', `${schedule.length} exams scheduled successfully (Basic Algorithm)`);
  }

  generateEnhancedSchedule() {
    console.log('🚀 Starting enhanced schedule generation...');
    
    Swal.fire({
      title: 'Processing',
      text: 'Generating schedule with all constraints...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: () => {
        Swal.showLoading();
      }
    });

    setTimeout(() => {
      try {
        const subjectGroups = this.groupSubjectsBySharedId();
        const sortedSubjects = this.prioritizeSubjects(subjectGroups);
        const targets = this.calculateTargets();
        const result = this.assignWithAllConstraints(sortedSubjects, targets);
        
        Swal.close();
        
        setTimeout(() => {
          this.currentStep = 'generate';
          
          let dayMsg = `Day 1: ${result.day1} subjects`;
          if (result.day2 > 0) dayMsg += `, Day 2: ${result.day2} subjects`;
          if (result.day3 > 0) dayMsg += `, Day 3: ${result.day3} subjects`;
          
          this.showToast(
            'Schedule Generated',
            `${result.assigned} subjects assigned! ${dayMsg} (Enhanced Algorithm)`
          );
        }, 100);

      } catch (error) {
        Swal.close();
        console.error('❌ Error:', error);
        setTimeout(() => {
          this.global.swalAlertError(`Generation error: ${error.message || 'Unknown error'}`);
        }, 100);
      }
    }, 300);
  }

  private groupSubjectsBySharedId(): Map<string, Exam[]> {
    const groups = new Map<string, Exam[]>();
    
    for (const exam of this.exams) {
      if (!groups.has(exam.subjectId)) {
        groups.set(exam.subjectId, []);
      }
      const examList = groups.get(exam.subjectId);
      if (examList) {
        examList.push(exam);
      }
    }
    
    return groups;
  }

  private prioritizeSubjects(groups: Map<string, Exam[]>): Array<any> {
    const subjects: Array<any> = [];
    
    for (const [subjectId, exams] of groups.entries()) {
      const units = exams[0].lec + exams[0].oe;
      const type = this.subjectTypes.get(subjectId) || 'major';
      
      subjects.push({
        subjectId,
        exams,
        units,
        type,
        count: exams.length
      });
    }
    
    subjects.sort((a, b) => {
      if (a.units !== b.units) return b.units - a.units;
      if (a.count !== b.count) return b.count - a.count;
      if (a.type !== b.type) return a.type === 'genEd' ? -1 : 1;
      return a.subjectId.localeCompare(b.subjectId);
    });
    
    return subjects;
  }

  private calculateTargets(): Map<string, number[]> {
    const targets = new Map<string, number[]>();
    const numDays = this.days.length;
    const isSummer = this.activeTerm && this.activeTerm.endsWith('3');
    const maxPerDay = isSummer ? 6 : 4;
    
    const courseGroups = new Map<string, Exam[]>();
    for (const exam of this.exams) {
      const key = `${exam.course}_${exam.yearLevel}`;
      if (!courseGroups.has(key)) {
        courseGroups.set(key, []);
      }
      const examList = courseGroups.get(key);
      if (examList) {
        examList.push(exam);
      }
    }
    
    for (const [key, exams] of courseGroups.entries()) {
      const uniqueSubjects = new Set(exams.map(e => e.subjectId));
      const total = uniqueSubjects.size;
      
      const perDay = Math.ceil(total / numDays);
      const targetArr: number[] = [];
      
      for (let i = 0; i < numDays; i++) {
        targetArr.push(Math.min(perDay, maxPerDay));
      }
      
      targets.set(key, targetArr);
    }
    
    return targets;
  }

  private assignWithAllConstraints(sortedSubjects: Array<any>, targets: Map<string, number[]>): any {
    const assigned = new Set<string>();
    const slotMap = new Map<string, {day: string, slot: string}>();
    const dayCount = new Map<string, Map<string, number>>();
    const dayMajors = new Map<string, Map<string, Set<string>>>();
    const schedule: ScheduledExam[] = [];
    
    const courseKeys = new Set<string>();
    for (const exam of this.exams) {
      const key = `${exam.course}_${exam.yearLevel}`;
      courseKeys.add(key);
    }
    
    for (const key of courseKeys) {
      dayCount.set(key, new Map());
      dayMajors.set(key, new Map());
      
      for (const day of this.days) {
        const dayCountMap = dayCount.get(key);
        const dayMajorsMap = dayMajors.get(key);
        if (dayCountMap) {
          dayCountMap.set(day, 0);
        }
        if (dayMajorsMap) {
          dayMajorsMap.set(day, new Set());
        }
      }
    }
    
    const usedRoomsBySlot: { [key: string]: Set<string> } = {};
    
    for (const subject of sortedSubjects) {
      if (assigned.has(subject.subjectId)) continue;
      
      if (slotMap.has(subject.subjectId)) {
        const existing = slotMap.get(subject.subjectId);
        if (existing) {
          this.assignSubjectToSchedule(subject, existing.day, existing.slot, schedule, usedRoomsBySlot, dayCount, dayMajors);
          assigned.add(subject.subjectId);
          continue;
        }
      }
      
      const slot = this.findBestSlotStrict(subject, dayCount, dayMajors, targets);
      
      if (slot) {
        this.assignSubjectToSchedule(subject, slot.day, slot.slot, schedule, usedRoomsBySlot, dayCount, dayMajors);
        slotMap.set(subject.subjectId, slot);
        assigned.add(subject.subjectId);
        console.log(`✅ ${subject.subjectId} → ${slot.day} ${slot.slot}`);
      } else {
        console.warn(`⚠️ Failed: ${subject.subjectId}`);
      }
    }
    
    this.generatedSchedule = schedule;
    
    const day1 = this.countDayAssignments(dayCount, 0);
    const day2 = this.days.length > 1 ? this.countDayAssignments(dayCount, 1) : 0;
    const day3 = this.days.length > 2 ? this.countDayAssignments(dayCount, 2) : 0;
    
    return {
      success: assigned.size === sortedSubjects.length,
      assigned: assigned.size,
      total: sortedSubjects.length,
      day1,
      day2,
      day3
    };
  }

  private findBestSlotStrict(
    subject: any,
    dayCount: Map<string, Map<string, number>>,
    dayMajors: Map<string, Map<string, Set<string>>>,
    targets: Map<string, number[]>
  ): {day: string, slot: string} | null {
    
    const dayScores = this.calculateDayPreference(subject.exams, dayCount, targets);
    
    for (const {day} of dayScores) {
      const slotOrder = this.getDistributedSlotOrder(day);
      
      for (const slotIndex of slotOrder) {
        const slot = this.timeSlots[slotIndex];
        
        if (subject.type === 'genEd' && slot === '7:30-9:00') {
          continue;
        }
        
        if (this.checkAllConstraints(subject, day, slot, dayCount, dayMajors)) {
          return { day, slot };
        }
      }
    }
    
    return null;
  }

  private calculateDayPreference(
    exams: Exam[],
    dayCount: Map<string, Map<string, number>>,
    targets: Map<string, number[]>
  ): Array<{day: string, dayIndex: number, score: number}> {
    
    const scores: Array<any> = [];
    
    for (let i = 0; i < this.days.length; i++) {
      const day = this.days[i];
      let score = 0;
      
      for (const exam of exams) {
        const key = `${exam.course}_${exam.yearLevel}`;
        const dayCountMap = dayCount.get(key);
        const targetArr = targets.get(key);
        
        // ✅ FIXED: Replace optional chaining
        const current = (dayCountMap && dayCountMap.get(day)) || 0;
        const target = (targetArr && targetArr[i]) || 4;
        
        if (current < target) {
          score += (target - current) * 100;
        } else {
          score -= (current - target) * 50;
        }
      }
      
      scores.push({ day, dayIndex: i, score });
    }
    
    scores.sort((a, b) => b.score - a.score);
    
    return scores;
  }

  private getDistributedSlotOrder(day: string): number[] {
    const slotCounts: number[] = new Array(this.timeSlots.length).fill(0);
    
    for (const exam of this.generatedSchedule) {
      if (exam.DAY === day) {
        const idx = this.timeSlots.indexOf(exam.SLOT);
        if (idx >= 0) slotCounts[idx]++;
      }
    }
    
    const slotInfo = this.timeSlots.map((slot, index) => ({
      index,
      count: slotCounts[index]
    }));
    
    slotInfo.sort((a, b) => {
      if (a.count !== b.count) return a.count - b.count;
      return a.index - b.index;
    });
    
    return slotInfo.map(s => s.index);
  }

  private checkAllConstraints(
    subject: any,
    day: string,
    slot: string,
    dayCount: Map<string, Map<string, number>>,
    dayMajors: Map<string, Map<string, Set<string>>>
  ): boolean {
    
    const slotIdx = this.timeSlots.indexOf(slot);
    const isSummer = this.activeTerm && this.activeTerm.endsWith('3');
    const maxPerDay = isSummer ? 6 : 4;
    
    for (const exam of subject.exams) {
      const key = `${exam.course}_${exam.yearLevel}`;
      
      // ✅ FIXED: Replace optional chaining
      const dayCountMap = dayCount.get(key);
      const count = (dayCountMap && dayCountMap.get(day)) || 0;
      if (count >= maxPerDay) {
        return false;
      }
      
      if (slotIdx > 0) {
        const prevSlot = this.timeSlots[slotIdx - 1];
        if (this.generatedSchedule.some(e => 
          e.DAY === day && e.SLOT === prevSlot && 
          e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
        )) {
          return false;
        }
      }
      
      if (slotIdx + 1 < this.timeSlots.length) {
        const nextSlot = this.timeSlots[slotIdx + 1];
        if (this.generatedSchedule.some(e => 
          e.DAY === day && e.SLOT === nextSlot && 
          e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
        )) {
          return false;
        }
      }
      
      if (subject.type === 'major') {
        if (slotIdx > 0) {
          const prevSlot = this.timeSlots[slotIdx - 1];
          const prevExam = this.generatedSchedule.find(e => 
            e.DAY === day && e.SLOT === prevSlot && 
            e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
          );
          if (prevExam && this.subjectTypes.get(prevExam.SUBJECT_ID) === 'major') {
            return false;
          }
        }
        
        if (slotIdx + 2 < this.timeSlots.length) {
          const slot2Ahead = this.timeSlots[slotIdx + 2];
          const exam2Ahead = this.generatedSchedule.find(e => 
            e.DAY === day && e.SLOT === slot2Ahead && 
            e.COURSE === exam.course && e.YEAR_LEVEL === exam.yearLevel
          );
          if (exam2Ahead && this.subjectTypes.get(exam2Ahead.SUBJECT_ID) === 'major') {
            return false;
          }
        }
      }
    }
    
    return true;
  }

  private assignSubjectToSchedule(
    subject: any,
    day: string,
    slot: string,
    schedule: ScheduledExam[],
    usedRoomsBySlot: { [key: string]: Set<string> },
    dayCount: Map<string, Map<string, number>>,
    dayMajors: Map<string, Map<string, Set<string>>>
  ): void {
    
    const slotKey = `${day}|${slot}`;
    if (!usedRoomsBySlot[slotKey]) {
      usedRoomsBySlot[slotKey] = new Set<string>();
    }
    
    for (const exam of subject.exams) {
      const availableRoom = this.assignRoomByDepartment(exam, usedRoomsBySlot[slotKey], this.rooms);
      
      if (availableRoom) {
        usedRoomsBySlot[slotKey].add(availableRoom);
        
        schedule.push({
          CODE: exam.code,
          SUBJECT_ID: exam.subjectId,
          DESCRIPTIVE_TITLE: exam.title,
          COURSE: exam.course,
          YEAR_LEVEL: exam.yearLevel,
          INSTRUCTOR: exam.instructor,
          DEPT: exam.dept,
          OE: exam.oe,
          DAY: day,
          SLOT: slot,
          ROOM: availableRoom
        });
        
        if (subject.units === 6) {
          const nextSlot = this.getNextSlot(slot);
          if (nextSlot) {
            const nextSlotKey = `${day}|${nextSlot}`;
            if (!usedRoomsBySlot[nextSlotKey]) {
              usedRoomsBySlot[nextSlotKey] = new Set<string>();
            }
            usedRoomsBySlot[nextSlotKey].add(availableRoom);
            
            schedule.push({
              CODE: exam.code,
              SUBJECT_ID: exam.subjectId,
              DESCRIPTIVE_TITLE: exam.title,
              COURSE: exam.course,
              YEAR_LEVEL: exam.yearLevel,
              INSTRUCTOR: exam.instructor,
              DEPT: exam.dept,
              OE: exam.oe,
              DAY: day,
              SLOT: nextSlot,
              ROOM: availableRoom
            });
          }
        }
        
        const key = `${exam.course}_${exam.yearLevel}`;
        
        // ✅ FIXED: Replace optional chaining
        const dayCountMap = dayCount.get(key);
        if (dayCountMap) {
          const count = dayCountMap.get(day) || 0;
          dayCountMap.set(day, count + 1);
        }
        
        if (subject.type === 'major') {
          const dayMajorsMap = dayMajors.get(key);
          if (dayMajorsMap) {
            const majorsSet = dayMajorsMap.get(day);
            if (majorsSet) {
              majorsSet.add(subject.subjectId);
            }
          }
        }
      }
    }
  }

  private getNextSlot(slot: string): string | null {
    const idx = this.timeSlots.indexOf(slot);
    return (idx >= 0 && idx + 1 < this.timeSlots.length) ? this.timeSlots[idx + 1] : null;
  }

  private countDayAssignments(
    dayCount: Map<string, Map<string, number>>,
    dayIndex: number
  ): number {
    const day = this.days[dayIndex];
    const uniqueSubjects = new Set<string>();
    
    for (const exam of this.generatedSchedule) {
      if (exam.DAY === day) {
        uniqueSubjects.add(exam.SUBJECT_ID);
      }
    }
    
    return uniqueSubjects.size;
  }

  downloadScheduleCSV() {
    if (this.generatedSchedule.length === 0) return;

    const headers = ['Code', 'Subject ID', 'Title', 'Course', 'Year Level', 'Instructor', 'Dept', 'Day', 'Time', 'Room'];
    const rows = this.generatedSchedule.map(item => [
      item.CODE, item.SUBJECT_ID, item.DESCRIPTIVE_TITLE, item.COURSE,
      item.YEAR_LEVEL, item.INSTRUCTOR, item.DEPT, item.DAY, item.SLOT, item.ROOM
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
      csv += row.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    
    // ✅ FIXED: Replace optional chaining
    const groupName = (this.selectedExamGroup && this.selectedExamGroup.name) || 'export';
    saveAs(blob, `exam_schedule_${groupName}.csv`);
  }

  generateCourseSummaryData() {
    const summaryMap: { [course: string]: ScheduledExam[] } = {};
    this.generatedSchedule.forEach(exam => {
      if (!summaryMap[exam.COURSE]) summaryMap[exam.COURSE] = [];
      summaryMap[exam.COURSE].push(exam);
    });

    const sorted = Object.keys(summaryMap).sort();
    this.courseSummary = sorted.map(course => {
      const courseExams = summaryMap[course].sort((a, b) => {
        if (a.YEAR_LEVEL !== b.YEAR_LEVEL) return a.YEAR_LEVEL - b.YEAR_LEVEL;
        if (a.DAY !== b.DAY) return a.DAY.localeCompare(b.DAY);
        return a.SLOT.localeCompare(b.SLOT);
      });

      const yearLevelGroups: { [yearLevel: number]: any[] } = {};
      
      courseExams.forEach(exam => {
        const yearLevel = exam.YEAR_LEVEL || 1;
        if (!yearLevelGroups[yearLevel]) {
          yearLevelGroups[yearLevel] = [];
        }
        
        let group = yearLevelGroups[yearLevel].find(g => 
          g.day === exam.DAY && g.slot === exam.SLOT
        );
        
        if (!group) {
          group = { day: exam.DAY, slot: exam.SLOT, exams: [] };
          yearLevelGroups[yearLevel].push(group);
        }
        
        group.exams.push(exam);
      });

      const yearLevelGroupsArray = Object.keys(yearLevelGroups)
        .map(Number)
        .sort((a, b) => a - b)
        .map(yearLevel => ({
          yearLevel,
          groups: yearLevelGroups[yearLevel]
        }));

      return { course, yearLevelGroups: yearLevelGroupsArray };
    });
  }

  viewCourseSummary() {
    this.generateCourseSummaryData();
    this.currentStep = 'summary';
  }

  generateRoomTimeTableData() {
    const uniqueRooms = Array.from(new Set(this.generatedSchedule.map(e => e.ROOM))).sort();
    const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

    const table: any = {};
    uniqueDays.forEach(day => {
      table[day] = {};
      uniqueRooms.forEach(room => {
        table[day][room] = {};
        this.timeSlots.forEach(slot => {
          table[day][room][slot] = null;
        });
      });
    });

    this.generatedSchedule.forEach(exam => {
      table[exam.DAY][exam.ROOM][exam.SLOT] = {
        code: exam.CODE,
        course: exam.COURSE,
        yearLevel: exam.YEAR_LEVEL || 1,
        dept: exam.DEPT,
        title: exam.DESCRIPTIVE_TITLE
      };
    });

    this.roomTimeData = { table, rooms: uniqueRooms, days: uniqueDays };
    this.activeDay = uniqueDays[0] || 'Day 1';
  }

  viewRoomTimeTable() {
    this.generateRoomTimeTableData();
    this.currentStep = 'timetable';
  }

  generateCourseGridData() {
    const uniqueCourses = Array.from(new Set(this.generatedSchedule.map(e => e.COURSE))).sort();
    const uniqueDays = Array.from(new Set(this.generatedSchedule.map(e => e.DAY)));

    const grid: any = {};
    uniqueDays.forEach(day => {
      grid[day] = {};
      uniqueCourses.forEach(course => {
        grid[day][course] = {};
        this.timeSlots.forEach(slot => {
          grid[day][course][slot] = [];
        });
      });
    });

    this.generatedSchedule.forEach(exam => {
      if (!grid[exam.DAY][exam.COURSE][exam.SLOT]) {
        grid[exam.DAY][exam.COURSE][exam.SLOT] = [];
      }
      grid[exam.DAY][exam.COURSE][exam.SLOT].push({
        subjectId: exam.SUBJECT_ID,
        title: exam.DESCRIPTIVE_TITLE,
        code: exam.CODE,
        room: exam.ROOM,
        dept: exam.DEPT,
        yearLevel: exam.YEAR_LEVEL || 1
      });
    });

    uniqueDays.forEach(day => {
      uniqueCourses.forEach(course => {
        this.timeSlots.forEach(slot => {
          if (grid[day][course][slot].length > 0) {
            grid[day][course][slot].sort((a: any, b: any) => a.yearLevel - b.yearLevel);
          }
        });
      });
    });

    this.courseGridData = { grid, courses: uniqueCourses, days: uniqueDays };
  }

  viewCourseGrid() {
    this.generateCourseGridData();
    this.currentStep = 'coursegrid';
  }

  getDeptColor(dept: string): string {
    const colors: { [key: string]: string } = {
      'SACE': '#ef4444',
      'SABH': '#facc15',
      'SECAP': '#3b82f6',
      'SHAS': '#22c55e'
    };
    return dept ? colors[dept.toUpperCase()] || '#6b7280' : '#6b7280';
  }

  startEdit(index: number) {
    this.editingRow = index;
    this.editedExam = { ...this.generatedSchedule[index] };
  }

  cancelEdit() {
    this.editingRow = null;
    this.editedExam = null;
  }

  saveEdit() {
    if (this.editingRow !== null && this.editedExam) {
      this.generatedSchedule[this.editingRow] = this.editedExam;
      this.editingRow = null;
      this.editedExam = null;
      this.showToast('Saved', 'Exam updated successfully');
    }
  }

  updateEditField(field: keyof ScheduledExam, value: any) {
    if (this.editedExam) {
      (this.editedExam as any)[field] = value;
    }
  }

  goToStep(step: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid') {
    this.currentStep = step;
  }

  findSafeSlots(title: string, currentDay: string, currentSlot: string): any[] {
    const safeSlots: { day: string; slot: string }[] = [];
    
    const affectedExams = this.generatedSchedule.filter(e => 
      e.DESCRIPTIVE_TITLE.toUpperCase() === title.toUpperCase()
    );
    
    const affectedCourses = new Set(affectedExams.map(e => e.COURSE));

    this.days.forEach(day => {
      this.timeSlots.forEach(slot => {
        if (day === currentDay && slot === currentSlot) return;

        let hasConflict = false;
        affectedCourses.forEach(course => {
          const examsInSlot = this.generatedSchedule.filter(e => 
            e.DAY === day && e.SLOT === slot && e.COURSE === course
          );
          if (examsInSlot.length > 0) hasConflict = true;
        });

        if (!hasConflict) {
          safeSlots.push({ day, slot });
        }
      });
    });

    return safeSlots;
  }

  updateExamByTitle(title: string, newDay: string, newSlot: string) {
    this.generatedSchedule = this.generatedSchedule.map(exam => {
      if (exam.DESCRIPTIVE_TITLE.toUpperCase() === title.toUpperCase()) {
        return { ...exam, DAY: newDay, SLOT: newSlot };
      }
      return exam;
    });
    
    if (this.currentStep === 'coursegrid') {
      this.generateCourseGridData();
    }
    
    this.showToast('Updated', `All exams with title "${title}" moved to ${newDay} ${newSlot}`);
  }

  removeExamByTitle(title: string) {
    if (confirm(`Remove all exams with title "${title}"?`)) {
      this.generatedSchedule = this.generatedSchedule.filter(
        exam => exam.DESCRIPTIVE_TITLE.toUpperCase() !== title.toUpperCase()
      );
      
      if (this.currentStep === 'coursegrid') {
        this.generateCourseGridData();
      }
      
      this.showToast('Removed', `All exams with title "${title}" removed`);
    }
  }

  findSafeSlotsForGroup(group: ScheduledExam[]): SafeSlotOption[] {
    const safe: SafeSlotOption[] = [];
    const roomsList = this.rooms.length > 0 ? this.rooms : ['A', 'C', 'K', 'L', 'M', 'N'];

    for (let day of this.days) {
      for (let slot of this.timeSlots) {
        let safeForAll = true;

        for (let exam of group) {
          if (!this.isSlotSafeForExam(exam, day, slot)) {
            safeForAll = false;
            break;
          }
        }

        if (safeForAll) {
          const usedRooms = new Set(
            this.generatedSchedule
              .filter(e => e.DAY === day && e.SLOT === slot && !group.includes(e))
              .map(e => e.ROOM)
          );

          group.forEach(e => usedRooms.delete(e.ROOM));

          const availableRooms = roomsList.filter(r => !usedRooms.has(r));
          if (availableRooms.length >= group.length) {
            safe.push({ day, slot, availableRooms: availableRooms.slice(0, group.length) });
          }
        }
      }
    }

    return safe;
  }

  isSlotSafeForExam(exam: ScheduledExam, day: string, slot: string) {
    return !this.generatedSchedule.some(e =>
      e.DAY === day &&
      e.SLOT === slot &&
      e.COURSE === exam.COURSE &&
      e.SUBJECT_ID !== exam.SUBJECT_ID
    );
  }

  showMoveOptions(exam: ScheduledExam, day: string, slot: string) {
    if (!exam) {
      this.showToast('Error', 'Exam not found', 'destructive');
      return;
    }

    const group = this.generatedSchedule.filter(e => {
      const eSub = e.SUBJECT_ID ? e.SUBJECT_ID.toUpperCase().trim() : '';
      const examSub = exam.SUBJECT_ID ? exam.SUBJECT_ID.toUpperCase().trim() : '';
      return eSub === examSub;
    });

    this.moveExamData = { examRef: exam, groupExams: group };
    this.safeSlots = this.findSafeSlotsForGroup(group);

    this.movePopupVisible = true;
    this.cd.detectChanges();
  }

  closeMovePopup() {
    this.movePopupVisible = false;
  }

  applyMove(newDay: string, newSlot: string) {
    if (!this.moveExamData || !this.moveExamData.groupExams || this.moveExamData.groupExams.length === 0) {
      this.showToast('Error', 'No exams selected to move', 'destructive');
      return;
    }

    const group = this.moveExamData.groupExams;

    for (let exam of group) {
      exam.DAY = newDay;
      exam.SLOT = newSlot;

      const occupiedRooms = this.generatedSchedule
        .filter(e => e.DAY === newDay && e.SLOT === newSlot && e !== exam)
        .map(e => e.ROOM);

      const availableRoom = this.rooms.find(r => !occupiedRooms.includes(r));
      if (availableRoom) {
        exam.ROOM = availableRoom;
      }
    }

    if (this.currentStep === 'coursegrid') {
      this.generateCourseGridData();
    }

    this.movePopupVisible = false;
    this.showToast('Updated', `${group.length} exams moved to ${newDay} ${newSlot}`);
  }

  getFullExam(gridExam: any, day: string, slot: string): ScheduledExam | undefined {
    return this.generatedSchedule.find(e =>
      e.CODE === gridExam.code &&
      e.DAY === day &&
      e.SLOT === slot
    );
  }

  hasSavedData(): boolean {
    return !!localStorage.getItem('examScheduleData');
  }

  showRestorePrompt() {
    Swal.fire({
      title: 'Restore Previous Schedule?',
      text: 'We found a saved schedule. Would you like to restore it?',
      type: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, restore it',
      cancelButtonText: 'Start fresh'
    }).then((result) => {
      if (result.value) {
        this.loadFromLocalStorage();
      }
    });
  }

  saveToLocalStorage() {
    const dataToSave = {
      activeTerm: this.activeTerm,
      exams: this.exams,
      rooms: this.rooms,
      generatedSchedule: this.generatedSchedule,
      examDates: this.examDates,
      currentStep: this.currentStep,
      selectedExamGroup: this.selectedExamGroup
    };
    localStorage.setItem('examScheduleData', JSON.stringify(dataToSave));
    
    if (this.selectedExamGroup && this.activeTerm) {
      this.sharedData.setStudentMappingForGroup(
        this.selectedExamGroup.name,
        this.activeTerm,
        this.convertScheduleToMappingFormat()
      );
    }
    
    this.global.swalSuccess("Schedule saved to local storage!");
  }

  private convertScheduleToMappingFormat(): any[] {
    const output: any[] = [];
    
    this.examDates.forEach(date => {
      const daySchedule: any = {
        date,
        programs: []
      };
      
      const programMap = new Map<string, any>();
      
      this.generatedSchedule
        .filter(e => e.DAY === this.days[this.examDates.indexOf(date)])
        .forEach(exam => {
          const key = `${exam.COURSE}_${exam.YEAR_LEVEL}`;
          
          if (!programMap.has(key)) {
            programMap.set(key, {
              program: exam.COURSE,
              year: exam.YEAR_LEVEL,
              subjects: []
            });
          }
          
          const prog = programMap.get(key);
          if (prog) {
            prog.subjects.push({
              subjectId: exam.SUBJECT_ID,
              subjectTitle: exam.DESCRIPTIVE_TITLE,
              codeNo: exam.CODE,
              sched: exam.SLOT
            });
          }
        });
      
      daySchedule.programs = Array.from(programMap.values());
      output.push(daySchedule);
    });
    
    return output;
  }

  loadFromLocalStorage() {
    const saved = localStorage.getItem('examScheduleData');
    if (!saved) {
      this.global.swalAlertError("No saved schedule found.");
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      this.activeTerm = parsed.activeTerm || '';
      this.exams = parsed.exams || [];
      this.rooms = parsed.rooms || [];
      this.generatedSchedule = parsed.generatedSchedule || [];
      this.examDates = parsed.examDates || ['', '', ''];
      this.currentStep = parsed.currentStep || 'import';
      this.selectedExamGroup = parsed.selectedExamGroup || null;

      this.cdr.markForCheck();
      this.global.swalSuccess("Schedule loaded successfully!");
    } catch (err) {
      console.error("Error loading saved schedule:", err);
      this.global.swalAlertError("Failed to load saved schedule.");
    }
  }

  hasExamsForYear(course: string, year: number, day: string): boolean {
    if (!this.courseGridData.grid || !this.courseGridData.grid[day] || !this.courseGridData.grid[day][course]) {
      return false;
    }

    const slots = this.courseGridData.grid[day][course];
    for (let slot in slots) {
      if (slots[slot].some((exam: any) => exam.yearLevel === year)) {
        return true;
      }
    }
    return false;
  }

  getTermYearLabel(termYearCode: string): string {
    if (!termYearCode) return '';
    
    const termMap: any = { '1': '1st Term', '2': '2nd Term', '3': 'Summer' };
    const termCode = termYearCode.slice(-1);
    const yearPart = termYearCode.slice(0, -1);
    const year1 = yearPart.slice(0, 4);
    const year2 = '20' + yearPart.slice(-2);
    
    return `${termMap[termCode] || 'Unknown'} ${year1}-${year2}`;
  }

  hasEmptyDates(): boolean {
    return this.examDates.some(d => !d);
  }

  openDatePickerDialog() {
    const dialogRef = this.dialog.open(DatePickerComponent, {
      width: '800px',
      maxHeight: '90vh',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(() => {
      this.loadSavedExamGroups();
      this.cdr.detectChanges();
    });
  }

  getDateRange(days: ExamDay[]): string {
    if (!days || days.length === 0) return '-';

    const sorted = [...days].sort(
      (a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()
    );

    const dateStrings = sorted.map(d => {
      const dt = new Date(d.date!);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const yy = String(dt.getFullYear()).slice(-2);
      const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
      return `${mm}/${dd}/${yy} (${weekday})`;
    });

    return dateStrings.join(', ');
  }

  editGroup(group: ExamGroup) {
    const dialogRef = this.dialog.open(DatePickerComponent, {
      width: '800px',
      maxHeight: '90vh',
      data: { group, mode: 'edit' }
    });

    dialogRef.afterClosed().subscribe(() => {
      this.loadSavedExamGroups();
      this.cdr.detectChanges();
    });
  }

  deleteGroup(groupName: string) {
    if (confirm(`Delete exam group "${groupName}"?`)) {
      const groupToDelete = this.savedExamGroups.find(g => g.name === groupName);
      const currentlySelected = this.sharedData.getSelectedExamGroup();
      const isSelectedGroup = currentlySelected && currentlySelected.name === groupName;

      this.savedExamGroups = this.savedExamGroups.filter(g => g.name !== groupName);
      localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
      this.loadSavedExamGroups();

      if (isSelectedGroup) {
        console.log(`🗑️ Deleted selected group "${groupName}". Clearing all data...`);
        
        this.sharedData.clearExamDates();
        this.sharedData.clearSelectedExamGroup();
        this.sharedData.clearActiveTerm();
        
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
          console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
        }
        
        this.sharedData.clearStudentMapping();
        
        this.selectedExamGroup = null;
        this.examDates = ['', '', ''];
        this.activeTerm = '';
        
        this.global.swalSuccess(`Deleted "${groupName}". All associated data has been cleared.`);
      } else {
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
          console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
        }
        
        this.global.swalSuccess(`Deleted "${groupName}".`);
      }
    }
  }
}






























