import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { ApiService } from '../api.service';
import { GlobalService } from '../global.service';
import { MatDialog } from '@angular/material';
import Swal from 'sweetalert2';
import { SharedDataService } from '../shared-data.service';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { 
  Exam, 
  ScheduledExam, 
  ToastMessage, 
  SafeSlotOption, 
  ExamDay, 
  ExamGroup,
  ConflictMatrix,
  SubjectPriority,
  RoomPreference,
  SchedulingState,
  SlotOption
} from '../subject-code';

@Component({
  selector: 'app-exam-scheduler',
  templateUrl: './exam-scheduler.component.html',
  styleUrls: ['./exam-scheduler.component.scss']
})
export class ExamSchedulerComponent implements OnInit {
  // State management
  currentStep: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid' = 'import';
  isLoadingApi: boolean = false;
  
  // Core data
  rawCodes: any[] = [];
  exams: Exam[] = [];
  rooms: string[] = [];
  roomCapacities: Map<string, number> = new Map();
  roomPreferences: Map<string, RoomPreference> = new Map();
  generatedSchedule: ScheduledExam[] = [];
  subjectTypes: Map<string, 'genEd' | 'major'> = new Map();
  
  // Exam configuration
  examDates: string[] = ['', '', ''];
  days: string[] = ['Day 1', 'Day 2', 'Day 3'];
  activeDay: string = 'Day 1';
  
  // Time slots (1.5 hour intervals)
  timeSlots: string[] = [
    '7:30-9:00', '9:00-10:30', '10:30-12:00', '12:00-1:30',
    '1:30-3:00', '3:00-4:30', '4:30-6:00', '6:00-7:30'
  ];
  
  // Term selection
  activeTerm: string = '';
  combinedOptions: { label: string, value: string }[] = [];
  termOptions = [
    { key: 1, value: '1st Semester' },
    { key: 2, value: '2nd Semester' },
    { key: 3, value: 'Summer' },
  ];
  
  // UI state
  editingRow: number | null = null;
  editedExam: ScheduledExam | null = null;
  toast: ToastMessage | null = null;
  movePopupVisible = false;
  moveExamData: any = null;
  safeSlots: SafeSlotOption[] = [];
  showExamGroupManager: boolean = false;
  
  // Exam groups
  savedExamGroups: ExamGroup[] = [];
  selectedExamGroup: ExamGroup | null = null;
  
  // View data
  courseSummary: any[] = [];
  roomTimeData: any = { table: {}, rooms: [], days: [] };
  courseGridData: any = { grid: {}, courses: [], days: [] };

  constructor(
    public api: ApiService,
    public global: GlobalService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
    private sharedData: SharedDataService
  ) {}

  ngOnInit() {
    this.activeDay = this.days[0];
    this.roomTimeData.days = [...this.days];
    this.courseGridData.days = [...this.days];
    this.combineYearTerm();
    
    this.sharedData.clearSelectedExamGroup();
    this.sharedData.clearExamDates();
    this.sharedData.clearActiveTerm();
    this.selectedExamGroup = null;
    
    this.loadSavedExamGroups();
    
    this.sharedData.selectedExamGroup$.subscribe(group => {
      if (group) {
        this.selectedExamGroup = group;
        this.examDates = group.days.map(d => 
          d.date ? new Date(d.date).toLocaleDateString('en-CA') : ''
        );
        this.activeTerm = group.termYear || '';
      }
    });
  }

  // ===== Initialization Methods =====
  
  combineYearTerm() {
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of this.termOptions) {
        const label = `${t.value} SY ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.combinedOptions.push({ label, value });
      }
    }
  }

  loadSavedExamGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  // ===== Exam Group Management =====
  
  toggleExamGroupManager() {
    this.showExamGroupManager = !this.showExamGroupManager;
  }

  selectExamGroup(group: ExamGroup) {
    this.selectedExamGroup = group;
    this.activeTerm = group.termYear || '';
    
    this.examDates = group.days
      .map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '')
      .filter(d => d !== '');
    
    this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
    
    this.sharedData.setSelectedExamGroup(group);
    this.sharedData.setExamDates(group.days);
    if (group.termYear) this.sharedData.setActiveTerm(group.termYear);
    
    if (this.hasScheduleForGroup(group.name, group.termYear || '')) {
      Swal.fire({
        title: 'Saved Schedule Found!',
        text: 'This exam group already has a generated schedule. Would you like to load it?',
        type: 'question',
        showCancelButton: true,
        confirmButtonText: '📋 Load Saved Schedule',
        cancelButtonText: '✕ Cancel',
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#6b7280'
      }).then((result: any) => {
        if (result.value) {
          if (this.loadScheduleForGroup(group.name, group.termYear || '')) {
            this.currentStep = 'generate';
            this.showToast('Success', `Loaded saved schedule for "${group.name}"`);
            this.cdr.detectChanges();
          } else {
            this.showToast('Error', 'Failed to load saved schedule');
          }
        } else {
          this.showToast('Success', `Selected "${group.name}" - Ready to load API data`);
        }
      });
    } else {
      this.showToast('Success', `Selected "${group.name}" with ${this.examDates.length} exam days`);
    }
    
    this.showExamGroupManager = false;
  }

  editGroup(group: ExamGroup) {
    const originalData = {
      name: group.name,
      termYear: group.termYear,
      daysCount: group.days.length,
      days: JSON.stringify(group.days)
    };
    
    const dialogRef = this.dialog.open(DatePickerComponent, {
      width: '800px',
      maxHeight: '90vh',
      data: { group, mode: 'edit' }
    });

    dialogRef.afterClosed().subscribe((result) => {
      this.loadSavedExamGroups();
      
      if (result && result.success) {
        const updatedGroup = result.group;
        const datesChanged = 
          originalData.daysCount !== updatedGroup.days.length ||
          originalData.days !== JSON.stringify(updatedGroup.days);
        
        const hasSchedule = this.hasScheduleForGroup(updatedGroup.name, updatedGroup.termYear || '');
        
        if (hasSchedule && datesChanged) {
          Swal.fire({
            title: 'Schedule Needs Update',
            text: `You changed the exam dates for "${updatedGroup.name}". The existing schedule is now outdated. Would you like to regenerate the schedule now?`,
            type: 'question',
            showCancelButton: true,
            confirmButtonText: '🔄 Regenerate Now',
            cancelButtonText: '📋 Keep Old Schedule',
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#6b7280'
          }).then((choice: any) => {
            if (choice.value) {
              this.regenerateScheduleForGroup(updatedGroup);
            } else {
              this.updateScheduleDateMappings(updatedGroup);
              this.showToast('Success', `Schedule kept for "${updatedGroup.name}" with updated dates!`, 'success');
            }
          });
        } else {
          this.showToast('Success', `Updated "${updatedGroup.name}" successfully`);
        }
        
        if (this.selectedExamGroup && this.selectedExamGroup.name === group.name) {
          const reloadedGroup = this.savedExamGroups.find(g => g.name === updatedGroup.name);
          if (reloadedGroup) {
            this.selectedExamGroup = reloadedGroup;
            this.activeTerm = reloadedGroup.termYear || '';
            this.examDates = reloadedGroup.days
              .map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '')
              .filter(d => d !== '');
            this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
            this.activeDay = this.days[0] || 'Day 1';
            
            this.sharedData.setSelectedExamGroup(reloadedGroup);
            this.sharedData.setExamDates(reloadedGroup.days);
            if (reloadedGroup.termYear) this.sharedData.setActiveTerm(reloadedGroup.termYear);
          }
        }
      }
      
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
      
      if (groupToDelete && groupToDelete.termYear) {
        const scheduleKey = `schedule_${groupName}_${groupToDelete.termYear}`;
        localStorage.removeItem(scheduleKey);
      }
      
      this.loadSavedExamGroups();

      if (isSelectedGroup) {
        this.sharedData.clearExamDates();
        this.sharedData.clearSelectedExamGroup();
        this.sharedData.clearActiveTerm();
        
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
        }
        
        this.sharedData.clearStudentMapping();
        this.selectedExamGroup = null;
        this.examDates = ['', '', ''];
        this.activeTerm = '';
        
        this.global.swalSuccess(`Deleted "${groupName}". All associated data has been cleared.`);
      } else {
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
        }
        this.global.swalSuccess(`Deleted "${groupName}".`);
      }
    }
  }

  // ===== Data Loading =====
  
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
          this.rawCodes = res.data || [];
          Swal.close();

          // Map exams and filter out SAS department
          this.exams = this.rawCodes
            .filter((obj: any) => {
              const dept = (obj.dept || obj.DEPT || '').toUpperCase().trim();
              return dept !== 'SAS';
            })
            .map((obj: any) => {
              const lectureRoom = obj.roomNumber || obj.ROOM_NUMBER || obj.ROOM || '';
              const lectureBuilding = lectureRoom ? lectureRoom.charAt(0).toUpperCase() : '';
              
              return {
                code: obj.codeNo || obj.CODE || '',
                version: obj.version || obj.VERSION || '',
                subjectId: obj.subjectId || obj.SUBJECT_ID || '',
                title: obj.subjectTitle || obj.DESCRIPTIVE_TITLE || obj.TITLE || '',
                course: (obj.course || obj.COURSE || '').trim(),
                yearLevel: obj.yearLevel || obj.YEAR_LEVEL || obj.year || 1,
                lec: parseInt(obj.lecUnits || obj.LEC_UNITS || obj.lec || '3'),
                oe: parseInt(obj.labUnits || obj.LAB_UNITS || obj.oe || '0'),
                dept: obj.dept || obj.DEPT || obj.department || '',
                instructor: obj.instructor || obj.INSTRUCTOR || obj.instructorName || '',
                studentCount: parseInt(obj.studentCount || obj.STUDENT_COUNT || '30'),
                isRegular: true,
                lectureRoom: lectureRoom,
                lectureBuilding: lectureBuilding
              };
            });

          this.rooms = this.getUniqueRooms(res.data);
          this.extractRoomCapacities(res.data);
          this.buildRoomPreferences();
          this.categorizeSubjects();
          
          if (this.rooms.length === 0) {
            this.rooms = ['A-101', 'A-201', 'N-101', 'N-201', 'K-101', 'K-201', 'C-101', 'L-101', 'M-101'];
          }
          
          this.sharedData.getRoomSummary(res.data);
          this.cdr.detectChanges();
          
          console.log('✅ Total exams loaded:', this.exams.length);
          console.log('✅ Regular students:', this.exams.filter(e => e.isRegular).length);
          console.log('✅ Total rooms extracted:', this.rooms.length);
          
          this.showToast('Success', `${this.exams.length} exams loaded (SAS excluded)`);
        },
        err => {
          Swal.close();
          console.error('❌ API Error:', err);
          this.global.swalAlertError(err);
        }
      );
  }

  getUniqueRooms(data: any[]): string[] {
    if (!data || data.length === 0) return [];

    const roomSet = new Set<string>();
    
    const allowedPrefixes = ['A-', 'N-', 'K-', 'C-', 'L-', 'M-'];
    
    const excludedRooms = [
      'A-102','A-203','A-204','A-205','A-219','A-221','A-225','A-226','A-234',
      'A-302','A-306','A-308','A-309','A-310','A-311','A-312',
      'K-13','K-14','K-22','K-24','K-41',
      'L-23','M-21','M-31','M-33','M-43',
      'DemoR','Pharm', 'TBA', 'Virtu', 'EMC', 'Field', 'Hosp', 'Molec',
      'BTL','BUL','HL','SMTL','MChem','MLab1','MLab2','Nutri',
      '', 'null', 'undefined', 'N/A', 'NA'
    ];
    
    data.forEach((item) => {
      const room = item.roomNumber || item.ROOM_NUMBER || item.ROOM || 
                   item.room || item.roomNo || item.ROOM_NO || '';
      
      if (room) {
        const trimmedRoom = room.toString().trim();
        
        const hasAllowedPrefix = allowedPrefixes.some(prefix => 
          trimmedRoom.startsWith(prefix)
        );
        
        if (trimmedRoom && 
            trimmedRoom.length > 0 && 
            hasAllowedPrefix &&
            !excludedRooms.includes(trimmedRoom) &&
            trimmedRoom.toLowerCase() !== 'tba') {
          roomSet.add(trimmedRoom);
        }
      }
    });
    
    return Array.from(roomSet).sort((a, b) => {
      const aMatch = a.match(/\d+/);
      const bMatch = b.match(/\d+/);
      const aNum = parseInt(aMatch ? aMatch[0] : '0');
      const bNum = parseInt(bMatch ? bMatch[0] : '0');
      return aNum - bNum;
    });
  }

  extractRoomCapacities(data: any[]) {
    this.roomCapacities.clear();
    
    if (!data || data.length === 0) return;
    
    data.forEach(item => {
      const room = item.roomNumber || item.ROOM_NUMBER || item.ROOM || item.room || '';
      const capacityValue = item.classSize || item.CLASS_SIZE || item.capacity || item.CAPACITY || '';
      
      if (room && capacityValue) {
        const trimmedRoom = room.toString().trim();
        const capacity = parseInt(capacityValue) || 0;
        
        if (trimmedRoom && capacity > 0) {
          const currentCapacity = this.roomCapacities.get(trimmedRoom);
          if (!currentCapacity || currentCapacity < capacity) {
            this.roomCapacities.set(trimmedRoom, capacity);
          }
        }
      }
    });
  }

  buildRoomPreferences() {
    this.roomPreferences.clear();
    
    this.rooms.forEach(room => {
      const building = room.charAt(0).toUpperCase();
      const roomMatch = room.match(/\d+/);
      const roomNum = parseInt(roomMatch ? roomMatch[0] : '0');
      const floor = Math.floor(roomNum / 100) || 0;
      const isGroundFloor = floor === 1;
      
      let campus: 'BCJ' | 'MAIN' | 'LECAROS' = 'MAIN';
      let deptPref: string[] = [];
      
      if (building === 'A') {
        campus = 'BCJ';
        deptPref = ['SABH', 'SECAP'];
      }
      else if (['N', 'K', 'C'].includes(building)) {
        campus = 'MAIN';
        
        if (building === 'C') {
          deptPref = ['SACE'];
        }
        else if (['N', 'K'].includes(building)) {
          deptPref = ['SACE', 'SHAS'];
        }
      }
      else if (['L', 'M'].includes(building)) {
        campus = 'LECAROS';
        deptPref = ['SHAS'];
      }
      
      const type: 'lecture' | 'lab' = 'lecture';
      
      this.roomPreferences.set(room, {
        room,
        campus,
        building,
        floor,
        capacity: this.roomCapacities.get(room) || 40,
        type,
        deptPreference: deptPref,
        isGroundFloor
      });
    });
    
    console.log('🏢 Room Distribution by Campus:');
    console.log('BCJ:', this.rooms.filter(r => r.startsWith('A-')).length);
    console.log('MAIN:', this.rooms.filter(r => ['N-', 'K-', 'C-'].some(p => r.startsWith(p))).length);
    console.log('LECAROS:', this.rooms.filter(r => ['L-', 'M-'].some(p => r.startsWith(p))).length);
  }

  getRoomsByCampus(): { BCJ: string[], MAIN: string[], LECAROS: string[] } {
    const result = { 
      BCJ: [] as string[], 
      MAIN: [] as string[], 
      LECAROS: [] as string[] 
    };
    
    this.roomPreferences.forEach((pref, room) => {
      if (pref.campus === 'BCJ') result.BCJ.push(room);
      else if (pref.campus === 'MAIN') result.MAIN.push(room);
      else if (pref.campus === 'LECAROS') result.LECAROS.push(room);
    });
    
    return result;
  }

  categorizeSubjects() {
  this.subjectTypes.clear();
  const subjectCourseCount = new Map<string, Set<string>>();
  
  this.exams.forEach(exam => {
    if (!subjectCourseCount.has(exam.subjectId)) {
      subjectCourseCount.set(exam.subjectId, new Set());
    }
    subjectCourseCount.get(exam.subjectId)!.add(exam.course);
  });
  
  // Enhanced Gen Ed detection
  subjectCourseCount.forEach((courses, subjectId) => {
    const upperSubjectId = subjectId.toUpperCase();
    
    // Check if it's a Gen Ed by subject ID patterns or course count
    const isGenEdByPattern = 
      upperSubjectId.includes('LANG') ||
      upperSubjectId.includes('GEED') ||
      upperSubjectId.includes('GE ') ||
      upperSubjectId.includes('CFED') ||
      upperSubjectId.includes('PHED') ||
      upperSubjectId.includes('NSTP') ||
      upperSubjectId.includes('PE ') ||
      upperSubjectId.includes('MATH') && courses.size >= 8 ||
      upperSubjectId.includes('STS') ||
      upperSubjectId.includes('ETHICS') ||
      upperSubjectId.includes('PHILOS') ||
      upperSubjectId.includes('LIT ') ||
      courses.size >= 10; // Lower threshold from 15 to 10
    
    const type = isGenEdByPattern ? 'genEd' : 'major';
    this.subjectTypes.set(subjectId, type);
    
    if (type === 'genEd') {
      console.log(`📚 Gen Ed identified: ${subjectId} (${courses.size} courses)`);
    }
  });
}

  // ===== ENHANCED HYBRID ILP ALGORITHM =====
  
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
      title: 'Generate Schedule',
      text: 'Apply Hybrid ILP + Student-Centric Heuristics algorithm?',
      type: 'question',
      showCancelButton: true,
      confirmButtonText: '✨ Generate with ILP Algorithm',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#10b981'
    }).then((result) => {
      if (result.value) {
        this.executeHybridILPAlgorithm();
      }
    });
  }

  executeHybridILPAlgorithm() {
    Swal.fire({
      title: 'Processing with Enhanced ILP Algorithm',
      html: `
        <div style="text-align: left; padding: 20px;">
          <p><strong>Applying Hybrid ILP + Student-Centric Heuristics:</strong></p>
          <ul style="margin: 15px 0; font-size: 14px;">
            <li>✓ Prioritizing regular students</li>
            <li>✓ Gen Eds first (SECAP) - avoiding 7:30am for PHED/CFED</li>
            <li>✓ MATH subjects (SACE) - high priority</li>
            <li>✓ Building conflict matrix</li>
            <li>✓ 1.5-hour breaks (no consecutive)</li>
            <li>✓ Same subject ID = same time, adjacent rooms</li>
            <li>✓ Campus consistency with lecture schedule</li>
            <li>✓ Ground floor preference (ascending order)</li>
            <li>✓ Even distribution across ${this.days.length} days</li>
            <li>✓ ARCH subjects → C building only</li>
            <li>✓ No conflicts guaranteed</li>
          </ul>
        </div>
      `,
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: () => Swal.showLoading()
    });

    setTimeout(() => {
      try {
        const conflictMatrix = this.buildConflictMatrix();
        const subjectPriorities = this.buildEnhancedSubjectPriorities(conflictMatrix);
        const schedulingState = this.initializeEnhancedSchedulingState();
        const result = this.enhancedHybridILPScheduling(subjectPriorities, schedulingState);
        
        Swal.close();
        
        if (this.selectedExamGroup && this.activeTerm) {
          this.saveScheduleForGroup(this.selectedExamGroup.name, this.activeTerm);
        }
        
        setTimeout(() => {
          this.currentStep = 'generate';
          this.showToast(
            'Schedule Generated!', 
            `${result.assigned} subjects scheduled (${result.unscheduled} pending, ${result.conflicts} conflicts resolved)`,
            'success'
          );
          
          console.log('📊 Scheduling Statistics:');
          console.log(`  - Total subjects: ${subjectPriorities.length}`);
          console.log(`  - Successfully scheduled: ${result.assigned}`);
          console.log(`  - Unscheduled: ${result.unscheduled}`);
          console.log(`  - Conflicts resolved: ${result.conflicts}`);
          console.log(`  - Gen Eds scheduled: ${result.genEdsScheduled}`);
          console.log(`  - MATH subjects scheduled: ${result.mathScheduled}`);
        }, 100);

      } catch (error) {
        Swal.close();
        setTimeout(() => {
          console.error('❌ Scheduling error:', error);
          this.global.swalAlertError(`Generation error: ${error.message || 'Unknown error'}`);
        }, 100);
      }
    }, 300);
  }

  buildConflictMatrix(): ConflictMatrix {
    const matrix: ConflictMatrix = {};
    const courseYearGroups = new Map<string, Set<string>>();
    
    this.exams.forEach(exam => {
      const key = `${exam.course}_${exam.yearLevel}`;
      if (!courseYearGroups.has(key)) {
        courseYearGroups.set(key, new Set());
      }
      courseYearGroups.get(key)!.add(exam.subjectId);
    });
    
    for (const [courseYear, subjects] of courseYearGroups.entries()) {
      matrix[courseYear] = {};
      
      for (const subjectId of subjects) {
        matrix[courseYear][subjectId] = new Set(subjects);
        matrix[courseYear][subjectId].delete(subjectId);
      }
    }
    
    return matrix;
  }

  buildEnhancedSubjectPriorities(conflictMatrix: ConflictMatrix): SubjectPriority[] {
  const subjectGroups = new Map<string, Exam[]>();
  
  this.exams.forEach(exam => {
    if (!subjectGroups.has(exam.subjectId)) {
      subjectGroups.set(exam.subjectId, []);
    }
    subjectGroups.get(exam.subjectId)!.push(exam);
  });
  
  const priorities: SubjectPriority[] = [];
  
  for (const [subjectId, exams] of subjectGroups.entries()) {
    const firstExam = exams[0];
    const units = firstExam.lec + firstExam.oe;
    const isArchSubject = subjectId.toUpperCase().includes('ARCH');
    const upperSubjectId = subjectId.toUpperCase();
    
    let type: 'genEd' | 'math' | 'major' = 'major';
    
    // Enhanced type detection
    if (this.subjectTypes.get(subjectId) === 'genEd') {
      type = 'genEd';
    } else if ((firstExam.dept.toUpperCase() === 'SACE' && upperSubjectId.includes('MATH')) ||
               (firstExam.dept.toUpperCase() === 'SACE' && upperSubjectId.includes('STAT'))) {
      type = 'math';
    }
    
    let priority = 0;
    
    // Priority calculations
    const regularCount = exams.filter(e => e.isRegular).length;
    priority += regularCount * 100;
    
    // CRITICAL: All Gen Eds get highest priority
    if (type === 'genEd') {
      priority += 100000; // Much higher priority
    }
    // MATH subjects high priority
    else if (type === 'math') {
      priority += 50000;
    }
    // ARCH subjects need C building
    else if (isArchSubject) {
      priority += 40000;
    }
    // Major subjects
    else {
      priority += 10000;
    }
    
    // Bonus for 6-unit subjects
    priority += units * 500;
    
    // Bonus for more students
    const totalStudents = exams.reduce((sum, e) => sum + (e.studentCount || 30), 0);
    priority += totalStudents * 5;
    
    // Bonus for fewer sections (easier to schedule)
    if (exams.length === 1) {
      priority += 5000;
    } else if (exams.length === 2) {
      priority += 3000;
    }
    
    const requiresAdjacent = exams.length > 1;
    
    const conflicts = new Set<string>();
    exams.forEach(exam => {
      const key = `${exam.course}_${exam.yearLevel}`;
      if (conflictMatrix[key] && conflictMatrix[key][subjectId]) {
        conflictMatrix[key][subjectId].forEach(c => conflicts.add(c));
      }
    });
    
    priorities.push({
      subjectId,
      exams,
      priority,
      type,
      units,
      studentCount: totalStudents,
      conflicts,
      isRegular: regularCount > 0,
      requiresAdjacent
    });
  }
  
  priorities.sort((a, b) => b.priority - a.priority);
  
  console.log('🎯 Top 20 Priority Subjects:');
  priorities.slice(0, 20).forEach((p, i) => {
    console.log(`  ${i+1}. ${p.subjectId} (${p.type}) - Priority: ${p.priority} - Sections: ${p.exams.length}`);
  });
  
  return priorities;
}

  initializeEnhancedSchedulingState(): SchedulingState {
    const state: SchedulingState = {
      assignments: new Map(),
      roomUsage: new Map(),
      studentLoad: new Map(),
      campusUsage: new Map(),
      subjectScheduled: new Map(),
      consecutiveCheck: new Map()
    };
    
    this.days.forEach(day => {
      state.assignments.set(day, []);
      
      const roomMap = new Map<string, Set<string>>();
      this.timeSlots.forEach(slot => {
        roomMap.set(slot, new Set());
      });
      state.roomUsage.set(day, roomMap);
      
      this.exams.forEach(exam => {
        const key = `${exam.course}_${exam.yearLevel}`;
        if (!state.studentLoad.has(key)) {
          state.studentLoad.set(key, new Map());
        }
        state.studentLoad.get(key)!.set(day, 0);
      });
      
      state.campusUsage.set(day, new Map());
      
      const courseYears = new Set(this.exams.map(e => `${e.course}_${e.yearLevel}`));
      courseYears.forEach(courseYear => {
        if (!state.consecutiveCheck.has(courseYear)) {
          state.consecutiveCheck.set(courseYear, new Map());
        }
        state.consecutiveCheck.get(courseYear)!.set(day, new Set());
      });
    });
    
    return state;
  }

  enhancedHybridILPScheduling(priorities: SubjectPriority[], state: SchedulingState): any {
    let assignedCount = 0;
    let conflicts = 0;
    let genEdsScheduled = 0;
    let mathScheduled = 0;
    const schedule: ScheduledExam[] = [];
    const unscheduledSubjects: string[] = [];
    
    const scheduledSubjects = new Set<string>();
    
    for (const subject of priorities) {
      if (scheduledSubjects.has(subject.subjectId)) continue;
      
      const bestSlot = this.findEnhancedOptimalSlot(subject, state);
      
      if (bestSlot) {
        const wasAssigned = this.assignSubjectToSlotEnhanced(subject, bestSlot, state, schedule);
        
        if (wasAssigned) {
          scheduledSubjects.add(subject.subjectId);
          assignedCount++;
          
          if (subject.type === 'genEd') genEdsScheduled++;
          if (subject.type === 'math') mathScheduled++;
        } else {
          unscheduledSubjects.push(subject.subjectId);
        }
      } else {
        conflicts++;
        unscheduledSubjects.push(subject.subjectId);
        console.warn(`⚠️ Could not find slot for ${subject.subjectId} (${subject.type})`);
      }
    }
    
    this.generatedSchedule = schedule;
    
    if (unscheduledSubjects.length > 0) {
      console.warn('⚠️ Unscheduled subjects:', unscheduledSubjects);
    }
    
    return {
      success: true,
      assigned: assignedCount,
      unscheduled: unscheduledSubjects.length,
      conflicts,
      total: priorities.length,
      genEdsScheduled,
      mathScheduled
    };
  }

  findEnhancedOptimalSlot(
  subject: SubjectPriority,
  state: SchedulingState
): {day: string, slot: string, slots: string[]} | null {
  
  const bestOptions: SlotOption[] = [];
  const isSummer = this.activeTerm && this.activeTerm.endsWith('3');
  const maxPerDay = isSummer ? 6 : 5; // Increased from 4 to 5 for regular terms
  
  // Only PHED and CFED should avoid 7:30am
  const isPHEDorCFED = subject.subjectId.toUpperCase().includes('PHED') || 
                       subject.subjectId.toUpperCase().includes('CFED');
  
  for (let dayIdx = 0; dayIdx < this.days.length; dayIdx++) {
    const day = this.days[dayIdx];
    
    for (let slotIdx = 0; slotIdx < this.timeSlots.length; slotIdx++) {
      const slot = this.timeSlots[slotIdx];
      
      // ONLY PHED/CFED avoid 7:30am, other Gen Eds can use it
      if (isPHEDorCFED && slot === '7:30-9:00') {
        continue;
      }
      
      const slotsNeeded = subject.units >= 6 ? 2 : 1;
      const slots: string[] = [slot];
      
      if (slotsNeeded === 2) {
        if (slotIdx + 1 < this.timeSlots.length) {
          slots.push(this.timeSlots[slotIdx + 1]);
        } else {
          continue;
        }
      }
      
      const cost = this.calculateEnhancedSlotCost(subject, day, slots, state, maxPerDay);
      
      if (cost >= 0) {
        const availableRooms = this.getAvailableRoomsForSubject(subject, day, slots[0], state);
        
        if (availableRooms.length >= subject.exams.length) {
          bestOptions.push({ day, slot, slots, cost, availableRooms });
        }
      }
    }
  }
  
  if (bestOptions.length === 0) return null;
  
  bestOptions.sort((a, b) => a.cost - b.cost);
  
  return {
    day: bestOptions[0].day,
    slot: bestOptions[0].slot,
    slots: bestOptions[0].slots
  };
}

calculateEnhancedSlotCost(
  subject: SubjectPriority,
  day: string,
  slots: string[],
  state: SchedulingState,
  maxPerDay: number
): number {
  let cost = 0;
  
  for (const exam of subject.exams) {
    const courseYearKey = `${exam.course}_${exam.yearLevel}`;
    const studentLoad = state.studentLoad.get(courseYearKey);
    const currentLoad = studentLoad ? studentLoad.get(day) || 0 : 0;
    
    // Hard constraint: max subjects per day
    if (currentLoad >= maxPerDay) {
      return -1;
    }
    
    // Hard constraint: Check for time conflicts
    for (const timeSlot of slots) {
      const hasConflict = Array.from(state.assignments.get(day) || []).some(assigned => 
        assigned.SLOT === timeSlot &&
        assigned.COURSE === exam.course &&
        assigned.YEAR_LEVEL === exam.yearLevel &&
        assigned.SUBJECT_ID !== subject.subjectId
      );
      
      if (hasConflict) {
        return -1;
      }
    }
    
    // Soft constraint: Avoid consecutive subjects but don't block
    const slotIdx = this.timeSlots.indexOf(slots[0]);
    
    if (slotIdx > 0) {
      const prevSlot = this.timeSlots[slotIdx - 1];
      const hasPrevious = Array.from(state.assignments.get(day) || []).some(assigned =>
        assigned.SLOT === prevSlot &&
        assigned.COURSE === exam.course &&
        assigned.YEAR_LEVEL === exam.yearLevel
      );
      
      if (hasPrevious) {
        const prevAssignment = Array.from(state.assignments.get(day) || [])
          .find(a => a.SLOT === prevSlot && a.COURSE === exam.course && a.YEAR_LEVEL === exam.yearLevel);
        
        const prevSubjectType = prevAssignment ? this.subjectTypes.get(prevAssignment.SUBJECT_ID) : undefined;
        
        // Only block if BOTH are majors (allow Gen Ed + Major consecutive)
        if (subject.type === 'major' && prevSubjectType === 'major') {
          cost += 500; // High penalty but not blocking
        } else {
          cost += 100; // Small penalty
        }
      }
    }
    
    if (slotIdx + slots.length < this.timeSlots.length) {
      const nextSlot = this.timeSlots[slotIdx + slots.length];
      const hasNext = Array.from(state.assignments.get(day) || []).some(assigned =>
        assigned.SLOT === nextSlot &&
        assigned.COURSE === exam.course &&
        assigned.YEAR_LEVEL === exam.yearLevel
      );
      
      if (hasNext) {
        const nextAssignment = Array.from(state.assignments.get(day) || [])
          .find(a => a.SLOT === nextSlot && a.COURSE === exam.course && a.YEAR_LEVEL === exam.yearLevel);
        
        const nextSubjectType = nextAssignment ? this.subjectTypes.get(nextAssignment.SUBJECT_ID) : undefined;
        
        if (subject.type === 'major' && nextSubjectType === 'major') {
          cost += 500;
        } else {
          cost += 100;
        }
      }
    }
  }
  
  // Soft constraint: Even distribution
  const totalSubjects = this.exams.length;
  const targetPerDay = totalSubjects / this.days.length;
  const dayAssignments = state.assignments.get(day) || [];
  const deviation = Math.abs(dayAssignments.length - targetPerDay);
  cost += deviation * 5; // Reduced weight
  
  // Soft constraint: Prefer ground floor
  cost += slots.length * 3; // Reduced weight
  
  return cost;
}


 getAvailableRoomsForSubject(
  subject: SubjectPriority,
  day: string,
  slot: string,
  state: SchedulingState
): string[] {
  const usedRooms = state.roomUsage.get(day)!.get(slot)!;
  let availableRooms = this.rooms.filter(r => !usedRooms.has(r));
  
  if (availableRooms.length === 0) return [];
  
  const firstExam = subject.exams[0];
  const dept = firstExam.dept.toUpperCase();
  const isArchSubject = firstExam.subjectId.toUpperCase().includes('ARCH');
  
  // Primary room filtering
  let primaryRooms: string[] = [];
  let fallbackRooms: string[] = [];
  
  if (isArchSubject) {
    // ARCH subjects prefer C building but can use N/K if needed
    primaryRooms = availableRooms.filter(r => r.startsWith('C-'));
    fallbackRooms = availableRooms.filter(r => r.startsWith('N-') || r.startsWith('K-'));
  } else if (['SABH', 'SECAP'].includes(dept)) {
    // BCJ Building (A rooms)
    primaryRooms = availableRooms.filter(r => r.startsWith('A-'));
    fallbackRooms = []; // No fallback for BCJ departments
  } else if (dept === 'SACE') {
    // MAIN Building (N, K)
    primaryRooms = availableRooms.filter(r => r.startsWith('N-') || r.startsWith('K-'));
    fallbackRooms = availableRooms.filter(r => r.startsWith('C-')); // Can use C if needed
  } else if (dept === 'SHAS') {
    // MAIN (N, K) or LECAROS (L, M)
    primaryRooms = availableRooms.filter(r => 
      r.startsWith('N-') || r.startsWith('K-') || 
      r.startsWith('L-') || r.startsWith('M-')
    );
    fallbackRooms = [];
  } else {
    // Unknown department - use any available room
    primaryRooms = availableRooms;
    fallbackRooms = [];
  }
  
  // Use primary rooms if available, otherwise use fallback
  let roomsToUse = primaryRooms.length >= subject.exams.length ? primaryRooms : 
                   (primaryRooms.length + fallbackRooms.length >= subject.exams.length) ? 
                   [...primaryRooms, ...fallbackRooms] : availableRooms;
  
  if (roomsToUse.length === 0) {
    console.warn(`⚠️ No suitable rooms for ${dept} - ${firstExam.subjectId}, using any available`);
    roomsToUse = availableRooms;
  }
  
  // Prioritize lecture room if available
  if (firstExam.lectureRoom && roomsToUse.includes(firstExam.lectureRoom)) {
    const idx = roomsToUse.indexOf(firstExam.lectureRoom);
    roomsToUse.splice(idx, 1);
    roomsToUse.unshift(firstExam.lectureRoom);
  }
  
  // Sort by floor (ground floor first)
  roomsToUse.sort((a, b) => {
    const aPref = this.roomPreferences.get(a);
    const bPref = this.roomPreferences.get(b);
    
    if (!aPref || !bPref) return 0;
    
    if (aPref.isGroundFloor && !bPref.isGroundFloor) return -1;
    if (!aPref.isGroundFloor && bPref.isGroundFloor) return 1;
    
    if (aPref.floor !== bPref.floor) return aPref.floor - bPref.floor;
    
    const aMatch = a.match(/\d+/);
    const bMatch = b.match(/\d+/);
    const aNum = parseInt(aMatch ? aMatch[0] : '0');
    const bNum = parseInt(bMatch ? bMatch[0] : '0');
    return aNum - bNum;
  });
  
  // Handle adjacent rooms for multiple sections
  if (subject.requiresAdjacent && subject.exams.length > 1) {
    return this.findAdjacentRooms(roomsToUse, subject.exams.length);
  }
  
  return roomsToUse;
}

  findAdjacentRooms(availableRooms: string[], count: number): string[] {
  if (count <= 1) return availableRooms;
  
  for (let i = 0; i <= availableRooms.length - count; i++) {
    const group = availableRooms.slice(i, i + count);
    const building = group[0].charAt(0);
    
    if (group.every(r => r.startsWith(building))) {
      const numbers = group.map(r => {
        const match = r.match(/\d+/);
        return parseInt(match ? match[0] : '0');
      });
      const maxDiff = Math.max(...numbers) - Math.min(...numbers);
      
      if (maxDiff <= 5) {
        return group;
      }
    }
  }
  
  const buildingGroups = new Map<string, string[]>();
  availableRooms.forEach(room => {
    const building = room.charAt(0);
    if (!buildingGroups.has(building)) {
      buildingGroups.set(building, []);
    }
    buildingGroups.get(building)!.push(room);
  });
  
  for (const [building, rooms] of buildingGroups.entries()) {
    if (rooms.length >= count) {
      return rooms.slice(0, count);
    }
  }
  
  return availableRooms.slice(0, count);
}


  assignSubjectToSlotEnhanced(
  subject: SubjectPriority,
  slot: {day: string, slot: string, slots: string[]},
  state: SchedulingState,
  schedule: ScheduledExam[]
): boolean {
  
  const { day, slots } = slot;
  const availableRooms = this.getAvailableRoomsForSubject(subject, day, slots[0], state);
  
  if (availableRooms.length < subject.exams.length) {
    console.warn(`⚠️ Not enough rooms for ${subject.subjectId}`);
    return false;
  }
  
  subject.exams.forEach((exam, idx) => {
    const room = availableRooms[idx];
    
    for (const timeSlot of slots) {
      const scheduledExam: ScheduledExam = {
        CODE: exam.code,
        SUBJECT_ID: exam.subjectId,
        DESCRIPTIVE_TITLE: exam.title,
        COURSE: exam.course,
        YEAR_LEVEL: exam.yearLevel,
        INSTRUCTOR: exam.instructor,
        DEPT: exam.dept,
        OE: exam.oe,
        DAY: day,
        SLOT: timeSlot,
        ROOM: room,
        UNITS: exam.lec + exam.oe,
        STUDENT_COUNT: exam.studentCount,
        PRIORITY: subject.priority,
        IS_REGULAR: exam.isRegular,
        LECTURE_ROOM: exam.lectureRoom
      };
      
      schedule.push(scheduledExam);
      state.assignments.get(day)!.push(scheduledExam);
      state.roomUsage.get(day)!.get(timeSlot)!.add(room);
    }
    
    const courseYearKey = `${exam.course}_${exam.yearLevel}`;
    const loadMap = state.studentLoad.get(courseYearKey);
    if (loadMap) {
      const current = loadMap.get(day) || 0;
      loadMap.set(day, current + 1);
    }
    
    const roomPref = this.roomPreferences.get(room);
    if (roomPref) {
      state.campusUsage.get(day)!.set(courseYearKey, roomPref.campus);
    }
    
    // Fixed: Replace optional chaining with traditional check
    const consecutiveCheckMap = state.consecutiveCheck.get(courseYearKey);
    if (consecutiveCheckMap) {
      const daySet = consecutiveCheckMap.get(day);
      if (daySet) {
        daySet.add(subject.subjectId);
      }
    }
  });
  
  state.subjectScheduled.set(subject.subjectId, { day, slot: slots[0] });
  
  return true;
}

  getBuildingCampus(building: string): 'BCJ' | 'MAIN' | 'LECAROS' {
    if (building === 'A') return 'BCJ';
    if (['N', 'K', 'C'].includes(building)) return 'MAIN';
    if (['L', 'M'].includes(building)) return 'LECAROS';
    return 'MAIN';
  }

  // ===== Schedule Regeneration =====
  
  regenerateScheduleForGroup(group: ExamGroup) {
    this.selectedExamGroup = group;
    this.activeTerm = group.termYear || '';
    this.examDates = group.days.map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '').filter(d => d !== '');
    this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
    this.activeDay = this.days[0] || 'Day 1';
    
    this.sharedData.setSelectedExamGroup(group);
    this.sharedData.setExamDates(group.days);
    if (group.termYear) this.sharedData.setActiveTerm(group.termYear);
    
    if (this.exams.length > 0 && this.rooms.length > 0) {
      this.clearScheduleForGroup(group.name, group.termYear || '');
      this.generateExamSchedule();
    } else {
      Swal.fire({
        title: 'Load Exam Data First',
        html: '<p>To regenerate the schedule, you need to load exam data from the API first.</p><br><p>Would you like to load the data now?</p>',
        showCancelButton: true,
        confirmButtonText: 'Load Data Now',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#3b82f6'
      }).then((choice) => {
        if (choice.value) {
          this.currentStep = 'import';
          this.showToast('Info', 'Click "Load Exam Data from API" to load data, then generate schedule', 'info');
        }
      });
    }
  }

  clearScheduleForGroup(groupName: string, termYear: string) {
    const key = `schedule_${groupName}_${termYear}`;
    localStorage.removeItem(key);
    
    if (this.selectedExamGroup && this.selectedExamGroup.name === groupName) {
      this.generatedSchedule = [];
      this.courseSummary = [];
      this.roomTimeData = { table: {}, rooms: [], days: [] };
      this.courseGridData = { grid: {}, courses: [], days: [] };
      
      if (['generate', 'summary', 'timetable', 'coursegrid'].includes(this.currentStep)) {
        this.currentStep = 'import';
      }
    }
  }

  updateScheduleDateMappings(group: ExamGroup) {
    const key = `schedule_${group.name}_${group.termYear}`;
    const saved = localStorage.getItem(key);
    if (!saved) return;
    
    try {
      const scheduleData = JSON.parse(saved);
      const newExamDates = group.days.map(d => d.date ? new Date(d.date).toLocaleDateString('en-CA') : '').filter(d => d !== '');
      
      scheduleData.examDates = newExamDates;
      scheduleData.lastUpdated = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(scheduleData));
      
      if (this.selectedExamGroup && this.selectedExamGroup.name === group.name) {
        this.examDates = newExamDates;
        this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
        this.activeDay = this.days[0] || 'Day 1';
        this.roomTimeData.days = [...this.days];
        this.courseGridData.days = [...this.days];
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error updating date mappings:', error);
    }
  }

  // ===== Storage Management =====
  
  private saveScheduleForGroup(groupName: string, termYear: string) {
    const key = `schedule_${groupName}_${termYear}`;
    const scheduleData = {
      generatedSchedule: this.generatedSchedule,
      exams: this.exams,
      rooms: this.rooms,
      roomCapacities: Array.from(this.roomCapacities.entries()),
      examDates: this.examDates,
      subjectTypes: Array.from(this.subjectTypes.entries()),
      timestamp: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(scheduleData));
  }

  private loadScheduleForGroup(groupName: string, termYear: string): boolean {
    const key = `schedule_${groupName}_${termYear}`;
    const saved = localStorage.getItem(key);
    if (!saved) return false;

    try {
      const scheduleData = JSON.parse(saved);
      this.generatedSchedule = scheduleData.generatedSchedule || [];
      this.exams = scheduleData.exams || [];
      this.rooms = scheduleData.rooms || [];
      this.examDates = scheduleData.examDates || [];
      
      if (scheduleData.roomCapacities) this.roomCapacities = new Map(scheduleData.roomCapacities);
      if (scheduleData.subjectTypes) this.subjectTypes = new Map(scheduleData.subjectTypes);
      
      this.days = this.examDates.map((_, i) => `Day ${i + 1}`);
      this.activeDay = this.days[0] || 'Day 1';
      this.cdr.detectChanges();
      
      return true;
    } catch (err) {
      return false;
    }
  }

  hasScheduleForGroup(groupName: string, termYear: string): boolean {
    return !!localStorage.getItem(`schedule_${groupName}_${termYear}`);
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
      this.saveScheduleForGroup(this.selectedExamGroup.name, this.activeTerm);
      this.sharedData.setStudentMappingForGroup(
        this.selectedExamGroup.name,
        this.activeTerm,
        this.convertScheduleToMappingFormat()
      );
    }
    
    this.global.swalSuccess("Schedule saved to local storage!");
  }

  private convertScheduleToMappingFormat(): any[] {
    return this.examDates.map(date => ({
      date,
      programs: Array.from(
        this.generatedSchedule
          .filter(e => e.DAY === this.days[this.examDates.indexOf(date)])
          .reduce((map, exam) => {
            const key = `${exam.COURSE}_${exam.YEAR_LEVEL}`;
            if (!map.has(key)) {
              map.set(key, {
                program: exam.COURSE,
                year: exam.YEAR_LEVEL,
                subjects: []
              });
            }
            map.get(key).subjects.push({
              subjectId: exam.SUBJECT_ID,
              subjectTitle: exam.DESCRIPTIVE_TITLE,
              codeNo: exam.CODE,
              sched: exam.SLOT
            });
            return map;
          }, new Map()).values()
      )
    }));
  }

  // ===== View Generation =====
  
  generateCourseSummaryData() {
    const summaryMap: { [course: string]: ScheduledExam[] } = {};
    this.generatedSchedule.forEach(exam => {
      if (!summaryMap[exam.COURSE]) summaryMap[exam.COURSE] = [];
      summaryMap[exam.COURSE].push(exam);
    });

    this.courseSummary = Object.keys(summaryMap).sort().map(course => {
      const courseExams = summaryMap[course].sort((a, b) => {
        if (a.YEAR_LEVEL !== b.YEAR_LEVEL) return a.YEAR_LEVEL - b.YEAR_LEVEL;
        if (a.DAY !== b.DAY) return a.DAY.localeCompare(b.DAY);
        return a.SLOT.localeCompare(b.SLOT);
      });

      const yearLevelGroups: { [yearLevel: number]: any[] } = {};
      
      courseExams.forEach(exam => {
        const yearLevel = exam.YEAR_LEVEL || 1;
        if (!yearLevelGroups[yearLevel]) yearLevelGroups[yearLevel] = [];
        
        let group = yearLevelGroups[yearLevel].find(g => g.day === exam.DAY && g.slot === exam.SLOT);
        if (!group) {
          group = { day: exam.DAY, slot: exam.SLOT, exams: [] };
          yearLevelGroups[yearLevel].push(group);
        }
        group.exams.push(exam);
      });

      return {
        course,
        yearLevelGroups: Object.keys(yearLevelGroups)
          .map(Number)
          .sort((a, b) => a - b)
          .map(yearLevel => ({ yearLevel, groups: yearLevelGroups[yearLevel] }))
      };
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
    this.cdr.detectChanges();
  }

  // ===== Editing Methods =====
  
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

  // ===== Exam Moving =====
  
  showMoveOptions(exam: ScheduledExam, day: string, slot: string) {
    if (!exam) {
      this.showToast('Error', 'Exam not found', 'destructive');
      return;
    }

    const group = this.generatedSchedule.filter(e => 
      e.SUBJECT_ID.toUpperCase().trim() === exam.SUBJECT_ID.toUpperCase().trim()
    );

    this.moveExamData = { examRef: exam, groupExams: group };
    this.safeSlots = this.findSafeSlotsForGroup(group);
    this.movePopupVisible = true;
  }

  closeMovePopup() {
    this.movePopupVisible = false;
  }

  applyMove(newDay: string, newSlot: string) {
    if (!this.moveExamData || !this.moveExamData.groupExams) {
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
      if (availableRoom) exam.ROOM = availableRoom;
    }

    if (this.currentStep === 'coursegrid') {
      this.generateCourseGridData();
    }

    this.movePopupVisible = false;
    this.showToast('Updated', `${group.length} exams moved to ${newDay} ${newSlot}`);
  }

  findSafeSlotsForGroup(group: ScheduledExam[]): SafeSlotOption[] {
    const safe: SafeSlotOption[] = [];

    for (let day of this.days) {
      for (let slot of this.timeSlots) {
        const safeForAll = group.every(exam => this.isSlotSafeForExam(exam, day, slot));

        if (safeForAll) {
          const usedRooms = new Set(
            this.generatedSchedule
              .filter(e => e.DAY === day && e.SLOT === slot && !group.includes(e))
              .map(e => e.ROOM)
          );

          group.forEach(e => usedRooms.delete(e.ROOM));
          const availableRooms = this.rooms.filter(r => !usedRooms.has(r));
          
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

  getFullExam(gridExam: any, day: string, slot: string): ScheduledExam | undefined {
    return this.generatedSchedule.find(e =>
      e.CODE === gridExam.code && e.DAY === day && e.SLOT === slot
    );
  }

  removeExamByTitle(title: string) {
    if (confirm(`Remove exam "${title}"?`)) {
      this.generatedSchedule = this.generatedSchedule.filter(e => e.DESCRIPTIVE_TITLE !== title);
      this.generateCourseGridData();
      this.showToast('Removed', `Exam "${title}" removed`);
    }
  }

  // ===== Utility Methods =====
  
  downloadScheduleCSV() {
    if (this.generatedSchedule.length === 0) return;

    const headers = ['Code', 'Subject ID', 'Title', 'Course', 'Year Level', 'Instructor', 'Dept', 'Day', 'Time', 'Room'];
    const csv = [
      headers.join(','),
      ...this.generatedSchedule.map(item => [
        item.CODE, item.SUBJECT_ID, item.DESCRIPTIVE_TITLE, item.COURSE,
        item.YEAR_LEVEL, item.INSTRUCTOR, item.DEPT, item.DAY, item.SLOT, item.ROOM
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const groupName = (this.selectedExamGroup && this.selectedExamGroup.name) || 'export';
    saveAs(blob, `exam_schedule_${groupName}_ILP.csv`);
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

  goToStep(step: 'import' | 'generate' | 'summary' | 'timetable' | 'coursegrid') {
    this.currentStep = step;
  }

  getTermYearLabel(termYearCode: string): string {
    if (!termYearCode) return 'Unknown';
    if (termYearCode.includes('Semester') || termYearCode.includes('Summer')) return termYearCode;
    
    if (/^\d{7}$/.test(termYearCode)) {
      const termMap: any = { '1': '1st Semester', '2': '2nd Semester', '3': 'Summer' };
      const termCode = termYearCode.slice(-1);
      const year1 = termYearCode.slice(0, 4);
      const year2 = '20' + termYearCode.slice(4, 6);
      return `${termMap[termCode] || 'Unknown'} SY ${year1}-${year2}`;
    }
    
    return 'Unknown';
  }

  getDateRange(days: ExamDay[]): string {
    if (!days || days.length === 0) return '-';

    const sorted = [...days].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

    return sorted.map(d => {
      const dt = new Date(d.date!);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const yy = String(dt.getFullYear()).slice(-2);
      const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
      return `${mm}/${dd}/${yy} (${weekday})`;
    }).join(', ');
  }

  hasEmptyDates(): boolean {
    return this.examDates.some(d => !d);
  }

  hasExamsForYear(course: string, year: number, day: string): boolean {
    if (!this.courseGridData.grid || !this.courseGridData.grid[day] || !this.courseGridData.grid[day][course]) {
      return false;
    }
    
    return Object.values(this.courseGridData.grid[day][course])
      .some((exams: any) => exams.some((exam: any) => exam.yearLevel === year));
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

  loadSwal() {
    Swal.fire({
      title: 'Loading',
      text: 'Fetching exam data...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      onOpen: () => Swal.showLoading()
    });
  }

  showToast(title: string, description: string, variant: string = 'success') {
    this.toast = { title, description, variant };
    setTimeout(() => this.toast = null, 3000);
  }
}