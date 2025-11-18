import { Component, Inject, OnInit, Optional } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SharedDataService } from '../shared-data.service';

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
  selector: 'app-date-picker',
  templateUrl: './date-picker.component.html',
  styleUrls: ['./date-picker.component.scss']
})
export class DatePickerComponent implements OnInit {
  examDays: ExamDay[] = [];
  savedExamGroups: ExamGroup[] = [];
  selectedGroupName: string | null = null;
  newGroupName: string = '';
  
  selectedTermYear: string = '';
  termYearOptions: { label: string, value: string }[] = [];

  showEditor = false;
  editingGroup: ExamGroup | null = null;

  maxDays = 5;
  minDate!: Date;
  maxDate!: Date;

  constructor(
    private sharedData: SharedDataService,
    @Optional() public dialogRef?: MatDialogRef<DatePickerComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data?: any
  ) {}

  ngOnInit() {
    const currentYear = new Date().getFullYear();
    this.minDate = new Date(currentYear, 0, 1);
    this.maxDate = new Date(2035, 11, 31);

    this.generateTermYearOptions();
    this.loadStoredGroups();
    this.resetExamDays();
  }

  generateTermYearOptions() {
    const currentYear = new Date().getFullYear();
    const terms = [
      { key: 1, value: '1st Term' },
      { key: 2, value: '2nd Term' },
      { key: 3, value: 'Summer' },
    ];

    for (let y = currentYear - 2; y <= currentYear + 1; y++) {
      const nextYear = y + 1;
      for (const t of terms) {
        const label = `${t.value} ${y}-${nextYear}`;
        const value = `${y}${nextYear.toString().slice(-2)}${t.key}`;
        this.termYearOptions.push({ label, value });
      }
    }
  }

  addDates() {
    this.showEditor = true;
    this.editingGroup = null;
    this.resetExamDays();
    this.newGroupName = '';
    this.selectedTermYear = '';
  }

  loadStoredGroups() {
    const stored = localStorage.getItem('examGroups');
    this.savedExamGroups = stored ? JSON.parse(stored) : [];
  }

  saveAllGroups() {
    localStorage.setItem('examGroups', JSON.stringify(this.savedExamGroups));
  }

  addDay() {
    if (this.examDays.length < this.maxDays) {
      this.examDays.push({ date: null, am: false, pm: false });
    }
  }

  removeDay(index: number) {
    this.examDays.splice(index, 1);
  }

  resetExamDays() {
    this.examDays = [{ date: null, am: false, pm: false }];
  }

  editGroup(group: ExamGroup) {
    this.editingGroup = group;
    this.showEditor = true;
    this.newGroupName = group.name;
    this.selectedTermYear = group.termYear || '';
    this.examDays = group.days.map(d => ({
      date: d.date ? new Date(d.date) : null,
      am: d.am,
      pm: d.pm
    }));
  }

  saveGroup() {
    const validDays = this.examDays.filter(d => d.date instanceof Date);

    if (!validDays.length) {
      alert('Please select at least one valid exam date.');
      return;
    }

    if (!this.newGroupName.trim()) {
      alert('Please enter a name for this exam schedule.');
      return;
    }

    if (!this.selectedTermYear) {
      alert('Please select a Term & School Year for this exam schedule.');
      return;
    }

    const updatedGroup: ExamGroup = {
      name: this.newGroupName.trim(),
      days: validDays,
      termYear: this.selectedTermYear
    };

    if (this.editingGroup) {
      const index = this.savedExamGroups.indexOf(this.editingGroup);
      if (index !== -1) {
        this.savedExamGroups[index] = updatedGroup;
        
        const currentlySelected = this.sharedData.getSelectedExamGroup();
        if (currentlySelected && currentlySelected.name === this.editingGroup.name) {
          console.log(`✏️ Updating currently selected group "${updatedGroup.name}"`);
          
          // ✅ Update SharedDataService - this triggers migration in student-mapping
          this.sharedData.setExamDates(updatedGroup.days);
          this.sharedData.setSelectedExamGroup(updatedGroup);
          this.sharedData.setActiveTerm(updatedGroup.termYear!);
          
          console.log("✅ Updated exam dates, triggering migration in student-mapping");
        }
      }
      alert('✏️ Exam group updated! Your schedule data has been preserved.');
    } else {
      const existingIndex = this.savedExamGroups.findIndex(
        g => g.name === updatedGroup.name
      );

      if (existingIndex !== -1) {
        if (confirm(`"${updatedGroup.name}" already exists. Replace it?`)) {
          this.savedExamGroups[existingIndex] = updatedGroup;
        } else {
          return;
        }
      } else {
        this.savedExamGroups.push(updatedGroup);
      }

      alert('✅ Exam group saved!');
    }

    this.saveAllGroups();
    this.loadStoredGroups();

    this.resetExamDays();
    this.newGroupName = '';
    this.selectedTermYear = '';
    this.showEditor = false;
    this.editingGroup = null;
  }

  deleteGroup(groupName: string) {
    if (confirm(`Delete exam group "${groupName}"?`)) {
      // ✅ Find the group being deleted to get its term/year
      const groupToDelete = this.savedExamGroups.find(g => g.name === groupName);
      
      const currentlySelected = this.sharedData.getSelectedExamGroup();
      const isSelectedGroup = currentlySelected && currentlySelected.name === groupName;

      // Remove from saved groups
      this.savedExamGroups = this.savedExamGroups.filter(g => g.name !== groupName);
      this.saveAllGroups();
      this.loadStoredGroups();

      if (isSelectedGroup) {
        console.log(`🗑️ Deleted selected group "${groupName}". Clearing all data...`);
        
        // ✅ Clear shared data service
        this.sharedData.clearExamDates();
        this.sharedData.clearSelectedExamGroup();
        this.sharedData.clearActiveTerm();
        
        // ✅ Clear the saved student mapping for this group
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
          console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
        }
        
        // Also clear legacy student mapping
        this.sharedData.clearStudentMapping();
        
        alert(`⚠️ Deleted "${groupName}". All associated data has been cleared.`);
      } else {
        // ✅ Even if not selected, clear its saved mapping data
        if (groupToDelete && groupToDelete.termYear) {
          this.sharedData.clearStudentMappingForGroup(groupName, groupToDelete.termYear);
          console.log(`🗑️ Cleared student mapping for "${groupName}" (${groupToDelete.termYear})`);
        }
        
        alert(`✅ Deleted "${groupName}".`);
      }
    }
  }

  selectGroup(group: ExamGroup) {
    this.selectedGroupName = group.name;
    
    // ✅ Set all data in SharedDataService
    this.sharedData.setExamDates(group.days);
    this.sharedData.setSelectedExamGroup(group);
    
    if (group.termYear) {
      this.sharedData.setActiveTerm(group.termYear);
      console.log(`✅ Set term to: ${group.termYear}`);
    }
    
    console.log(`✅ Selected "${group.name}" with ${group.days.length} days:`, group.days);
    alert(`✅ Selected "${group.name}" for scheduling.`);
  }

  dateFilter = (date: Date | null): boolean => {
    if (!date) return true;
    const selectedDates = this.examDays
      .map(d => d.date instanceof Date ? d.date.toDateString() : null)
      .filter(d => d !== null);
    return !selectedDates.includes(date.toDateString());
  };

  getTermAndYear(group: ExamGroup): string {
    if (group.termYear) {
      const termMap: any = { '1': '1st Term', '2': '2nd Term', '3': 'Summer' };
      const termCode = group.termYear.slice(-1);
      const yearPart = group.termYear.slice(0, -1);
      const year1 = yearPart.slice(0, 4);
      const year2 = '20' + yearPart.slice(-2);
      
      return `${termMap[termCode] || 'Unknown'} ${year1}-${year2}`;
    }
    
    const year = new Date().getFullYear();
    return `1st Sem ${year}-${year + 1}`;
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
      return `${mm}/${dd}/${yy}`;
    });

    return dateStrings.join(', ');
  }
}