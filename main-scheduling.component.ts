import { Component, OnInit } from '@angular/core';
import { MatStepper } from '@angular/material/stepper';
import { SharedDataService } from '../shared-data.service';

@Component({
  selector: 'app-main-scheduling',
  templateUrl: './main-scheduling.component.html',
  styleUrls: ['./main-scheduling.component.scss']
})
export class MainSchedulingComponent implements OnInit {

  constructor(private sharedData: SharedDataService) { }

  ngOnInit() {
  }

  // Check if Step 1 is complete (exam group selected with term/year)
  isStep1Complete(): boolean {
    const selectedGroup = this.sharedData.getSelectedExamGroup();
    const activeTerm = this.sharedData.getActiveTerm();
    const examDates = this.sharedData.getExamDates();
    
    return !!(selectedGroup && activeTerm && examDates && examDates.length > 0);
  }

  goNext(stepper: MatStepper) {
    // Validate before moving to next step
    if (stepper.selectedIndex === 0) {
      if (!this.isStep1Complete()) {
        alert('Please select an exam group with term and school year before proceeding.');
        return;
      }
    }
    
    stepper.next();
  }

  finish() {
    console.log('Scheduling complete!');
    alert('Exam schedule has been finalized!');
  }
}